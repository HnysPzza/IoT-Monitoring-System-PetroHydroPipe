const bcrypt = require('bcryptjs')
const { getSupabaseClient } = require('../../database/client')
const { getSensorLabel, getSensorPurpose } = require('../../shared/sensorIdentity')
const logger = require('../../utils/logger')
const { recordAuditLog } = require('../audit/audit.service')
const alertsService = require('../alerts/alerts.service')
const downtimeService = require('../downtime/downtime.service')

const AUDITABLE_SENSOR_EVENT_TYPES = new Set(['downtime', 'fault', 'recovered'])

function createIotError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function shouldRecordSensorEventAudit(eventType) {
  return AUDITABLE_SENSOR_EVENT_TYPES.has(eventType)
}

function getMachineRecord(sensorRecord) {
  if (Array.isArray(sensorRecord.machines)) {
    return sensorRecord.machines[0] || null
  }

  return sensorRecord.machines || null
}

function mapSensorStatusToLiveStatus(status) {
  if (status === 'Active') return 'Running'
  if (status === 'Fault') return 'Downtime'
  return 'Idle'
}

function toEventResponse(eventRecord, sensorRecord, processing = {}) {
  const machine = getMachineRecord(sensorRecord)

  return {
    id: eventRecord.id,
    eventId: eventRecord.device_event_id,
    sensorCode: sensorRecord.sensor_code,
    machineCode: machine?.machine_code || null,
    eventType: eventRecord.event_type,
    signal: eventRecord.event_value?.signal || null,
    recordedAt: eventRecord.recorded_at,
    duplicate: Boolean(processing.duplicate),
    stale: Boolean(processing.stale),
    stateApplied: Boolean(processing.state_applied),
  }
}

function toLiveSensorResponse(sensorRecord, latestEvent) {
  const signal = latestEvent?.event_value?.signal || null

  return {
    id: sensorRecord.id,
    sensorCode: sensorRecord.sensor_code,
    label: getSensorLabel(sensorRecord.sensor_code, sensorRecord.label),
    esp32DeviceId: sensorRecord.esp32_device_id,
    status: mapSensorStatusToLiveStatus(sensorRecord.status),
    signal,
    lastEventAt: latestEvent?.recorded_at || null,
    purpose: getSensorPurpose(sensorRecord.sensor_code),
  }
}

async function findSensorByDeviceId(deviceId) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('sensors')
    .select(`
      id,
      sensor_code,
      esp32_device_id,
      device_key_hash,
      label,
      status,
      machine_id,
      machines (
        id,
        machine_code,
        name,
        status,
        location,
        updated_at
      )
    `)
    .eq('esp32_device_id', deviceId)
    .maybeSingle()

  if (error) {
    throw createIotError(500, 'DEVICE_LOOKUP_FAILED', 'Unable to validate ESP32 device.')
  }

  return data
}

async function authenticateDevice({ deviceId, deviceKey }) {
  if (!deviceId || !deviceKey) {
    await recordAuditLog({
      action: 'IOT_DEVICE_AUTH_FAILED',
      entityType: 'iot_device',
      metadata: {
        deviceId: deviceId || null,
        reason: !deviceId ? 'missing_device_id' : 'missing_device_key',
      },
    })
    throw createIotError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
  }

  const sensor = await findSensorByDeviceId(deviceId)

  if (!sensor?.device_key_hash) {
    await recordAuditLog({
      action: 'IOT_DEVICE_AUTH_FAILED',
      entityType: 'iot_device',
      metadata: {
        deviceId,
        reason: sensor ? 'missing_device_key_hash' : 'unknown_device',
      },
    })
    throw createIotError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
  }

  const keyMatches = await bcrypt.compare(deviceKey, sensor.device_key_hash)

  if (!keyMatches) {
    await recordAuditLog({
      action: 'IOT_DEVICE_AUTH_FAILED',
      entityType: 'iot_device',
      metadata: {
        deviceId,
        sensorCode: sensor.sensor_code,
        reason: 'invalid_device_key',
      },
    })
    throw createIotError(401, 'DEVICE_UNAUTHORIZED', 'Invalid ESP32 device credentials.')
  }

  return sensor
}

async function processSensorEvent({ sensor, machine, payload, recordedAt }) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .rpc('ingest_iot_sensor_event', {
      p_device_event_id: payload.eventId,
      p_sensor_id: sensor.id,
      p_machine_id: machine.id,
      p_event_type: payload.eventType,
      p_event_value: {
        signal: payload.signal,
        metadata: payload.metadata || {},
      },
      p_recorded_at: recordedAt,
    })
    .single()

  if (error) {
    if (error.code === '22023') {
      throw createIotError(400, 'SENSOR_EVENT_REJECTED', 'Sensor event timestamp or state is invalid.')
    }

    throw createIotError(500, 'SENSOR_EVENT_PROCESSING_FAILED', 'Unable to process sensor event.')
  }

  return data
}

async function syncAlertState({ sensor, machine, eventRecord, payload, recordedAt }) {
  try {
    if (payload.eventType === 'downtime' || payload.eventType === 'fault') {
      await alertsService.createOrUpdateSensorAlert({
        sensor,
        machine,
        eventRecord,
        eventType: payload.eventType,
        signal: payload.signal,
        recordedAt,
      })
      return
    }

    if (payload.eventType === 'pulse' || payload.eventType === 'recovered') {
      await alertsService.resolveAlertForSource({
        sourceType: 'sensor',
        sourceId: sensor.id,
        metadata: {
          sensorCode: sensor.sensor_code,
          machineCode: machine.machine_code,
          eventId: eventRecord.id,
          eventType: payload.eventType,
          signal: payload.signal,
          recordedAt,
        },
      })
    }
  } catch (error) {
    logger.warn('Unable to sync alert state for sensor event.', {
      sensorCode: sensor.sensor_code,
      eventType: payload.eventType,
      eventId: payload.eventId,
      error: error.message,
    })
  }
}

async function recordStateTransitionAudits({ sensor, machine, eventRecord, payload, processing }) {
  if (processing.previous_machine_status !== processing.new_machine_status) {
    await recordAuditLog({
      action: 'IOT_MACHINE_STATUS_UPDATED',
      entityType: 'machine',
      entityId: machine.id,
      metadata: {
        machineCode: machine.machine_code,
        machineName: machine.name,
        previousStatus: processing.previous_machine_status,
        newStatus: processing.new_machine_status,
        source: 'esp32_event',
      },
    })
  }

  if (processing.downtime_action) {
    await recordAuditLog({
      action: processing.downtime_action === 'created' ? 'DOWNTIME_CREATED' : 'DOWNTIME_AUTO_RESOLVED',
      entityType: 'downtime',
      entityId: processing.downtime_id,
      metadata: {
        sensorCode: sensor.sensor_code,
        machineName: machine.name,
        eventId: eventRecord.id,
        deviceEventId: payload.eventId,
        eventType: payload.eventType,
        startedAt: processing.downtime_started_at,
        endedAt: processing.downtime_ended_at,
        durationMinutes: processing.downtime_duration_seconds == null
          ? null
          : Math.round(processing.downtime_duration_seconds / 60),
        cause: processing.downtime_cause,
        status: processing.downtime_action === 'created' ? 'Open' : 'Resolved',
      },
    })
  }
}

async function createSensorEvent({ deviceId, deviceKey, payload }) {
  const sensor = await authenticateDevice({ deviceId, deviceKey })
  const machine = getMachineRecord(sensor)

  if (!machine) {
    throw createIotError(500, 'DEVICE_MACHINE_MISSING', 'ESP32 device is not assigned to a machine.')
  }

  const recordedAt = payload.recordedAt || new Date().toISOString()
  const processing = await processSensorEvent({ sensor, machine, payload, recordedAt })
  const eventRecord = {
    id: processing.sensor_event_id,
    device_event_id: processing.device_event_id,
    event_type: processing.event_type,
    event_value: processing.event_value,
    recorded_at: processing.recorded_at,
  }

  if (processing.state_applied) {
    if (processing.downtime_action) {
      downtimeService.publishDowntimeEvent(
        processing.downtime_action === 'created' ? 'downtime.created' : 'downtime.resolved',
        {
          id: processing.downtime_id,
          status: processing.downtime_action === 'created' ? 'Open' : 'Resolved',
          sensorCode: sensor.sensor_code,
          machineCode: machine.machine_code,
        },
      )
    }

    await syncAlertState({ sensor, machine, eventRecord, payload, recordedAt })
    await recordStateTransitionAudits({ sensor, machine, eventRecord, payload, processing })
  }

  if (!processing.duplicate && shouldRecordSensorEventAudit(payload.eventType)) {
    await recordAuditLog({
      action: 'IOT_EVENT_RECEIVED',
      entityType: 'sensor_event',
      entityId: eventRecord.id,
      metadata: {
        deviceId,
        sensorCode: sensor.sensor_code,
        machineCode: machine.machine_code,
        deviceEventId: payload.eventId,
        eventType: payload.eventType,
        signal: payload.signal,
        recordedAt,
        stale: processing.stale,
        stateApplied: processing.state_applied,
      },
    })
  }

  return toEventResponse(eventRecord, sensor, processing)
}

async function getLiveFeed() {
  const supabase = getSupabaseClient()

  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('id, machine_code, name, status, location, updated_at')
    .eq('machine_code', 'M-01')
    .maybeSingle()

  if (machineError) {
    throw createIotError(500, 'LIVE_MACHINE_QUERY_FAILED', 'Unable to load live machine.')
  }

  if (!machine) {
    throw createIotError(404, 'MACHINE_NOT_FOUND', 'Spiral Mill 01 was not found.')
  }

  const { data: sensors, error: sensorsError } = await supabase
    .from('sensors')
    .select('id, sensor_code, esp32_device_id, label, status, machine_id, updated_at')
    .eq('machine_id', machine.id)
    .order('sensor_code', { ascending: true })

  if (sensorsError) {
    throw createIotError(500, 'LIVE_SENSORS_QUERY_FAILED', 'Unable to load live sensors.')
  }

  const sensorIds = (sensors || []).map((sensor) => sensor.id)
  let latestEvents = []

  if (sensorIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from('sensor_events')
      .select('id, sensor_id, event_type, event_value, recorded_at')
      .in('sensor_id', sensorIds)
      .order('recorded_at', { ascending: false })
      .limit(100)

    if (eventsError) {
      throw createIotError(500, 'LIVE_EVENTS_QUERY_FAILED', 'Unable to load latest sensor events.')
    }

    latestEvents = events || []
  }

  const latestEventBySensorId = new Map()

  latestEvents.forEach((event) => {
    if (!latestEventBySensorId.has(event.sensor_id)) {
      latestEventBySensorId.set(event.sensor_id, event)
    }
  })

  const liveSensors = (sensors || []).map((sensor) => toLiveSensorResponse(sensor, latestEventBySensorId.get(sensor.id)))
  const lastUpdated = latestEvents[0]?.recorded_at || machine.updated_at

  return {
    machine: {
      id: machine.id,
      machineCode: machine.machine_code,
      name: machine.name,
      status: machine.status,
      location: machine.location,
      activeSensors: liveSensors.filter((sensor) => sensor.status === 'Running').length,
      lastUpdated,
    },
    sensors: liveSensors,
  }
}

module.exports = {
  authenticateDevice,
  createSensorEvent,
  getLiveFeed,
  shouldRecordSensorEventAudit,
}
