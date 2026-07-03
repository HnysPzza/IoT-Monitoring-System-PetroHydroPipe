const bcrypt = require('bcryptjs')
const { getSupabaseClient } = require('../../database/client')
const { getSensorLabel, getSensorPurpose } = require('../../shared/sensorIdentity')
const { recordAuditLog } = require('../audit/audit.service')
const alertsService = require('../alerts/alerts.service')

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

function mapEventToSensorStatus(eventType) {
  if (eventType === 'pulse' || eventType === 'recovered') return 'Active'
  if (eventType === 'idle') return 'Inactive'
  return 'Fault'
}

function mapSensorStatusToLiveStatus(status) {
  if (status === 'Active') return 'Running'
  if (status === 'Fault') return 'Downtime'
  return 'Idle'
}

function getMachineStatusFromSensors(sensors) {
  if (sensors.some((sensor) => sensor.status === 'Fault')) return 'Downtime'
  if (sensors.some((sensor) => sensor.status === 'Active')) return 'Running'
  return 'Idle'
}

function toEventResponse(eventRecord, sensorRecord) {
  const machine = getMachineRecord(sensorRecord)

  return {
    id: eventRecord.id,
    sensorCode: sensorRecord.sensor_code,
    machineCode: machine?.machine_code || null,
    eventType: eventRecord.event_type,
    signal: eventRecord.event_value?.signal || null,
    recordedAt: eventRecord.recorded_at,
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

async function updateMachineStatus(machineId) {
  const supabase = getSupabaseClient()
  const { data: sensors, error: sensorsError } = await supabase
    .from('sensors')
    .select('id, status')
    .eq('machine_id', machineId)

  if (sensorsError) {
    throw createIotError(500, 'SENSOR_STATUS_QUERY_FAILED', 'Unable to evaluate machine status.')
  }

  const status = getMachineStatusFromSensors(sensors || [])
  const { error } = await supabase
    .from('machines')
    .update({ status })
    .eq('id', machineId)

  if (error) {
    throw createIotError(500, 'MACHINE_STATUS_UPDATE_FAILED', 'Unable to update machine status.')
  }

  await recordAuditLog({
    action: 'IOT_MACHINE_STATUS_UPDATED',
    entityType: 'machine',
    entityId: machineId,
    metadata: {
      newStatus: status,
      source: 'esp32_event',
    },
  })

  return status
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
    console.warn('Unable to sync alert state for sensor event.', {
      sensorCode: sensor.sensor_code,
      eventType: payload.eventType,
      error: error.message,
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
  const sensorStatus = mapEventToSensorStatus(payload.eventType)
  const supabase = getSupabaseClient()

  const { data: eventRecord, error: eventError } = await supabase
    .from('sensor_events')
    .insert({
      sensor_id: sensor.id,
      machine_id: machine.id,
      event_type: payload.eventType,
      event_value: {
        signal: payload.signal,
        metadata: payload.metadata || {},
      },
      recorded_at: recordedAt,
    })
    .select('id, event_type, event_value, recorded_at')
    .single()

  if (eventError) {
    throw createIotError(500, 'SENSOR_EVENT_CREATE_FAILED', 'Unable to save sensor event.')
  }

  const { error: sensorError } = await supabase
    .from('sensors')
    .update({ status: sensorStatus })
    .eq('id', sensor.id)

  if (sensorError) {
    throw createIotError(500, 'SENSOR_STATUS_UPDATE_FAILED', 'Unable to update sensor status.')
  }

  await updateMachineStatus(machine.id)
  await syncAlertState({ sensor, machine, eventRecord, payload, recordedAt })

  if (shouldRecordSensorEventAudit(payload.eventType)) {
    await recordAuditLog({
      action: 'IOT_EVENT_RECEIVED',
      entityType: 'sensor_event',
      entityId: eventRecord.id,
      metadata: {
        deviceId,
        sensorCode: sensor.sensor_code,
        machineCode: machine.machine_code,
        eventType: payload.eventType,
        signal: payload.signal,
        recordedAt,
      },
    })
  }

  return toEventResponse(eventRecord, sensor)
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
