const bcrypt = require('bcryptjs')
const { z } = require('zod')
const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const { getSensorLabel, getSensorPurpose } = require('../../shared/sensorIdentity')
const { recordAuditLog } = require('../audit/audit.service')
const { publishIngestionTransitions } = require('../operations/transitionPublisher')

const ALERT_TRANSITION_ACTIONS = new Set(['created', 'updated', 'acknowledged', 'resolved'])
const DOWNTIME_TRANSITION_ACTIONS = new Set(['created', 'resolved'])
const OUTPUT_REJECTION_REASONS = new Set([
  'stale_event',
  'machine_stationary',
  'machine_downtime',
  'server_debounce',
])

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

function mapSensorStatusToLiveStatus(sensorCode, status, machineStatus) {
  if (sensorCode === 'S-03' && machineStatus === 'Downtime') return 'Downtime'
  if (status === 'Active') return 'Running'
  if (status === 'Fault') return 'Fault'
  return 'Idle'
}

function getDowntimeOwnerSensorCode(processing) {
  if (!processing.downtime_action) return null
  return processing.downtime_sensor_code
}

function hasValidTransitionDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return false
  if (descriptor.kind === 'alert') {
    return ALERT_TRANSITION_ACTIONS.has(descriptor.action)
      && typeof descriptor.record?.id === 'string' && descriptor.record.id.length > 0
  }
  if (descriptor.kind === 'downtime') {
    return DOWNTIME_TRANSITION_ACTIONS.has(descriptor.action)
      && typeof descriptor.id === 'string' && descriptor.id.length > 0
      && descriptor.sensorCode === 'S-03'
      && typeof descriptor.machineCode === 'string' && descriptor.machineCode.length > 0
  }
  return false
}

function validateSensorEventResult(data) {
  const descriptors = data?.transition_descriptors
  const outputMetadata = data?.event_value?.metadata
  const outputAccepted = outputMetadata?.outputAccepted
  const outputRejectionReason = outputMetadata?.outputRejectionReason
  const hasOutputClassification = (outputAccepted === undefined && outputRejectionReason === undefined)
    || (outputAccepted === true && (outputRejectionReason === undefined || outputRejectionReason === null))
    || (outputAccepted === false && OUTPUT_REJECTION_REASONS.has(outputRejectionReason))
  const hasBasicFields = typeof data?.sensor_event_id === 'string'
    && typeof data.device_event_id === 'string'
    && typeof data.event_type === 'string'
    && data.event_value && typeof data.event_value === 'object'
    && typeof data.recorded_at === 'string'
    && typeof data.duplicate === 'boolean'
    && typeof data.stale === 'boolean'
    && typeof data.state_applied === 'boolean'
    && hasOutputClassification
    && Array.isArray(descriptors)
    && descriptors.every(hasValidTransitionDescriptor)

  const downtimeDescriptors = Array.isArray(descriptors)
    ? descriptors.filter((descriptor) => descriptor.kind === 'downtime')
    : []
  const hasMatchingDowntime = data?.downtime_action
    && data.downtime_sensor_code === 'S-03'
    && typeof data.downtime_id === 'string'
    && downtimeDescriptors.some((descriptor) => (
      descriptor.action === data.downtime_action && descriptor.id === data.downtime_id
    ))
  const transitionsMatchState = data?.state_applied
    ? (data.downtime_action ? hasMatchingDowntime : downtimeDescriptors.length === 0)
    : descriptors?.length === 0

  if (!hasBasicFields || !transitionsMatchState) {
    throw createIotError(500, 'SENSOR_EVENT_RESULT_INVALID', 'Unable to process sensor event.')
  }

  return data
}

function toEventResponse(eventRecord, sensorRecord, processing = {}) {
  const machine = getMachineRecord(sensorRecord)
  const outputMetadata = processing.event_value?.metadata
  const hasOutputClassification = sensorRecord.sensor_code === 'S-05'
    && eventRecord.event_type === 'pulse'
    && typeof outputMetadata?.outputAccepted === 'boolean'

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
    outputAccepted: hasOutputClassification ? outputMetadata.outputAccepted : null,
    outputRejectionReason: hasOutputClassification
      ? outputMetadata.outputRejectionReason || null
      : null,
    machineStatus: processing.new_machine_status || machine?.status || null,
    downtimeAction: processing.downtime_action || null,
    downtimeId: processing.downtime_id || null,
    downtimeSensorCode: getDowntimeOwnerSensorCode(processing),
  }
}

const liveTimestampSchema = z.string().datetime({ offset: true })
const nullableLiveTimestampSchema = liveTimestampSchema.nullable()
const liveSnapshotSchema = z.strictObject({
  snapshot_at: liveTimestampSchema,
  machine: z.strictObject({
    id: z.string().uuid(),
    machine_code: z.literal('M-01'),
    name: z.string().min(1),
    status: z.enum(['Running', 'Idle', 'Downtime']),
    location: z.string().nullable(),
    updated_at: liveTimestampSchema,
  }),
  sensors: z.array(z.strictObject({
    id: z.string().uuid(),
    sensor_code: z.enum(['S-01', 'S-02', 'S-03', 'S-04', 'S-05']),
    esp32_device_id: z.string().min(1),
    label: z.string().min(1),
    status: z.enum(['Active', 'Inactive', 'Fault']),
    updated_at: liveTimestampSchema,
    latest_event: z.strictObject({
      id: z.string().uuid(),
      event_type: z.string().min(1),
      signal: z.string().nullable(),
      recorded_at: liveTimestampSchema,
    }).nullable(),
    watchdog: z.strictObject({
      connectivity_state: z.enum(['unknown', 'online', 'offline']),
      detection_state: z.enum(['disabled', 'suspended', 'healthy', 'grace', 'downtime', 'recovering']),
      last_heartbeat_received_at: nullableLiveTimestampSchema,
      last_activity_received_at: nullableLiveTimestampSchema,
      last_evaluated_at: nullableLiveTimestampSchema,
    }).nullable(),
  })).length(5),
})

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

function isMonitoringStateFresh(snapshotAt, lastEvaluatedAt) {
  if (env.WATCHDOG_MODE === 'disabled' || !lastEvaluatedAt) return false
  const age = new Date(snapshotAt).getTime() - new Date(lastEvaluatedAt).getTime()
  const maximumAge = (env.WATCHDOG_TICK_INTERVAL_MS * 2) + env.WATCHDOG_EVALUATION_TIMEOUT_MS
  return age >= 0 && age <= maximumAge
}

function toLiveSensorResponse(sensorRecord, snapshotAt, machineStatus) {
  const stateFresh = isMonitoringStateFresh(snapshotAt, sensorRecord.watchdog?.last_evaluated_at)

  return {
    id: sensorRecord.id,
    sensorCode: sensorRecord.sensor_code,
    label: getSensorLabel(sensorRecord.sensor_code, sensorRecord.label),
    esp32DeviceId: sensorRecord.esp32_device_id,
    status: mapSensorStatusToLiveStatus(sensorRecord.sensor_code, sensorRecord.status, machineStatus),
    physicalStatus: sensorRecord.status,
    signal: sensorRecord.latest_event?.signal || null,
    lastEventAt: sensorRecord.latest_event?.recorded_at || null,
    purpose: getSensorPurpose(sensorRecord.sensor_code),
    monitoring: {
      stateFresh,
      connectivityState: stateFresh ? sensorRecord.watchdog.connectivity_state : null,
      detectionState: stateFresh ? sensorRecord.watchdog.detection_state : null,
      lastHeartbeatAt: sensorRecord.watchdog?.last_heartbeat_received_at || null,
      lastActivityAt: sensorRecord.watchdog?.last_activity_received_at || null,
      lastEvaluatedAt: sensorRecord.watchdog?.last_evaluated_at || null,
    },
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

  return validateSensorEventResult(data)
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
  const { data, error } = await supabase
    .rpc('get_machine_live_snapshot', { p_machine_code: 'M-01' })
    .single()

  if (error?.code === 'P0002') {
    throw createIotError(404, 'MACHINE_NOT_FOUND', 'Spiral Mill 01 was not found.')
  }
  if (error) {
    throw createIotError(500, 'LIVE_SNAPSHOT_QUERY_FAILED', 'Unable to load live monitoring data.')
  }

  const parsed = liveSnapshotSchema.safeParse(data)
  if (!parsed.success) {
    throw createIotError(500, 'LIVE_SNAPSHOT_INVALID', 'Unable to load live monitoring data.')
  }

  const { machine, sensors, snapshot_at: snapshotAt } = parsed.data
  const liveSensors = sensors.map((sensor) => toLiveSensorResponse(sensor, snapshotAt, machine.status))
  const lastEventAt = liveSensors.reduce(
    (latest, sensor) => (!latest || (sensor.lastEventAt && sensor.lastEventAt > latest) ? sensor.lastEventAt : latest),
    null,
  )

  return {
    monitoring: {
      mode: env.WATCHDOG_MODE,
      capturedAt: snapshotAt,
    },
    machine: {
      id: machine.id,
      machineCode: machine.machine_code,
      name: machine.name,
      status: machine.status,
      location: machine.location,
      activeSensors: liveSensors.filter((sensor) => sensor.status === 'Running').length,
      lastUpdated: lastEventAt || machine.updated_at,
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
