const bcrypt = require('bcryptjs')
const { getSupabaseClient } = require('../../database/client')
const { getSensorLabel, getSensorPurpose } = require('../../shared/sensorIdentity')
const { recordAuditLog } = require('../audit/audit.service')
const { publishIngestionTransitions } = require('../operations/transitionPublisher')

function createIotError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
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

function toHeartbeatResponse(processing, sensorRecord) {
  const machine = getMachineRecord(sensorRecord)

  return {
    heartbeatId: processing.heartbeat_id,
    sensorCode: sensorRecord.sensor_code,
    machineCode: machine?.machine_code || null,
    receivedAt: processing.received_at,
    connectivityState: processing.connectivity_state,
    duplicate: processing.duplicate,
    stale: processing.stale,
    stateApplied: processing.state_applied,
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

  if (!data) {
    throw createIotError(500, 'SENSOR_EVENT_PROCESSING_FAILED', 'Unable to process sensor event.')
  }

  return data
}

function validateHeartbeatResult(data, heartbeatId) {
  const isTimestamp = typeof data?.received_at === 'string'
    && !Number.isNaN(new Date(data.received_at).getTime())
  const isValid = data?.heartbeat_id === heartbeatId
    && typeof data.duplicate === 'boolean'
    && typeof data.stale === 'boolean'
    && typeof data.state_applied === 'boolean'
    && isTimestamp
    && ['unknown', 'online', 'offline'].includes(data.connectivity_state)
    && Number(data.duplicate) + Number(data.stale) + Number(data.state_applied) === 1

  if (!isValid) {
    throw createIotError(500, 'HEARTBEAT_PROCESSING_FAILED', 'Unable to process device heartbeat.')
  }

  return data
}

async function processHeartbeat({ sensor, machine, payload }) {
  const { data, error } = await getSupabaseClient()
    .rpc('ingest_iot_heartbeat', {
      p_heartbeat_id: payload.heartbeatId,
      p_sensor_id: sensor.id,
      p_machine_id: machine.id,
      p_boot_counter: payload.bootCounter,
      p_boot_id: payload.bootId,
      p_sequence: payload.sequence,
      p_recorded_at: payload.recordedAt,
      p_activity_observed: payload.activityObserved,
    })
    .single()

  if (error) {
    if (error.code === '22023') {
      throw createIotError(400, 'HEARTBEAT_REJECTED', 'Heartbeat timestamp or fields are invalid.')
    }
    if (error.code === '23505') {
      throw createIotError(409, 'HEARTBEAT_CONFLICT', 'Heartbeat ordering conflicts with device state.')
    }
    throw createIotError(500, 'HEARTBEAT_PROCESSING_FAILED', 'Unable to process device heartbeat.')
  }

  return validateHeartbeatResult(data, payload.heartbeatId)
}

async function createSensorEvent({ sensor, payload }) {
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
    publishIngestionTransitions({ sensor, machine, processing })
  }

  return toEventResponse(eventRecord, sensor, processing)
}

async function createHeartbeat({ sensor, payload }) {
  const machine = getMachineRecord(sensor)

  if (!machine) {
    throw createIotError(500, 'DEVICE_MACHINE_MISSING', 'ESP32 device is not assigned to a machine.')
  }

  const processing = await processHeartbeat({ sensor, machine, payload })
  return toHeartbeatResponse(processing, sensor)
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
  createHeartbeat,
  createSensorEvent,
  getLiveFeed,
}
