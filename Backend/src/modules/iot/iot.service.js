const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const { publishIngestionTransitions } = require('../operations/transitionPublisher')
const { requestLiveStatusPublish } = require('./liveStatusPublisher')
const { RESERVED_METADATA_KEYS } = require('./iot.model')
const { createIotError, getMachineRecord } = require('./iot.helpers')
const { authenticateDevice } = require('./iotDeviceAuth.service')
const {
  getDeviceOperationalThresholds,
  invalidateDeviceThresholdsCache,
} = require('./iotThresholds.service')
const { createHeartbeat } = require('./heartbeat.service')
const { getLiveFeed } = require('./iotLiveFeed.service')

const ALERT_TRANSITION_ACTIONS = new Set(['created', 'updated', 'acknowledged', 'resolved'])
const DOWNTIME_TRANSITION_ACTIONS = new Set(['created', 'resolved'])
const OUTPUT_REJECTION_REASONS = new Set([
  'stale_event',
  'machine_stationary',
  'machine_downtime',
  'machine_offline',
  'outside_schedule',
  'server_debounce',
])

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
    machineStatus: processing.new_machine_status || null,
    downtimeAction: processing.downtime_action || null,
    downtimeId: processing.downtime_id || null,
    downtimeSensorCode: getDowntimeOwnerSensorCode(processing),
  }
}

function assertAllowedEventMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return
  for (const key of RESERVED_METADATA_KEYS) {
    if (Object.hasOwn(metadata, key)) {
      throw createIotError(400, 'SENSOR_EVENT_REJECTED', `metadata.${key} is reserved for server use.`)
    }
  }
}

async function normalizeScheduleAwareEventPayload({ sensor, machine, payload, recordedAt }) {
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata
    : {}
  const isDeviceAbsenceFault = sensor.sensor_code !== 'S-05'
    && payload.eventType === 'fault'
    && metadata.detectionState === 'FAULT'
  const isUnconfirmedDeviceRecovery = sensor.sensor_code !== 'S-05'
    && (payload.eventType === 'recovered' || payload.eventType === 'pulse')
    && payload.signal === 'active'
    && metadata.detectionState === 'RUNNING'
    && metadata.recoveryConfirmed !== true

  if (!isDeviceAbsenceFault && !isUnconfirmedDeviceRecovery) {
    return {
      eventType: payload.eventType,
      signal: payload.signal,
      metadata,
    }
  }

  if (env.WATCHDOG_MODE === 'enforce') {
    const thresholds = await getDeviceOperationalThresholds(
      { ...sensor, machines: machine },
      { useCache: true, asOf: new Date(recordedAt) },
    )
    if (!thresholds || thresholds.absenceDetectionEnabled !== false) {
      return {
        eventType: payload.eventType,
        signal: payload.signal,
        metadata,
      }
    }
  }

  if (isDeviceAbsenceFault) {
    return {
      eventType: 'idle',
      signal: 'idle',
      metadata: {
        ...metadata,
        detectionState: 'IDLE',
      },
    }
  }

  return {
    eventType: payload.eventType,
    signal: payload.signal,
    metadata: {
      ...metadata,
      recoveryConfirmed: true,
    },
  }
}

async function processSensorEvent({ sensor, machine, payload, recordedAt }) {
  assertAllowedEventMetadata(payload.metadata)
  const supabase = getSupabaseClient()
  const normalized = await normalizeScheduleAwareEventPayload({
    sensor,
    machine,
    payload,
    recordedAt,
  })

  const { data, error } = await supabase
    .rpc('ingest_iot_sensor_event', {
      p_device_event_id: payload.eventId,
      p_sensor_id: sensor.id,
      p_machine_id: machine.id,
      p_event_type: normalized.eventType,
      p_event_value: {
        signal: normalized.signal,
        metadata: normalized.metadata,
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
    requestLiveStatusPublish()
  }

  return toEventResponse(eventRecord, sensor, processing)
}

module.exports = {
  authenticateDevice,
  createHeartbeat,
  createSensorEvent,
  getDeviceOperationalThresholds,
  getLiveFeed,
  invalidateDeviceThresholdsCache,
  requestLiveStatusPublish,
}
