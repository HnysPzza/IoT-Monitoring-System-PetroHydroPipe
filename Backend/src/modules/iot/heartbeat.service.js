const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const { requestLiveStatusPublish } = require('./liveStatusPublisher')
const { createIotError, getMachineRecord } = require('./iot.helpers')

const MAX_BOOT_COUNTER_OVERRIDES = 64
const deviceBootCounterOverrides = new Map()

function rememberBootCounterOverride(bootId, bootCounter) {
  if (deviceBootCounterOverrides.size >= MAX_BOOT_COUNTER_OVERRIDES) {
    const oldestKey = deviceBootCounterOverrides.keys().next().value
    if (oldestKey !== undefined) deviceBootCounterOverrides.delete(oldestKey)
  }
  deviceBootCounterOverrides.set(bootId, bootCounter)
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

async function resolveHeartbeatBootCounterOverride({ supabase, sensorId, payload, receivedAt }) {
  if (typeof supabase.from !== 'function') return null
  const { data: state, error } = await supabase
    .from('sensor_watchdog_state')
    .select('boot_counter, boot_id, last_heartbeat_received_at')
    .eq('sensor_id', sensorId)
    .maybeSingle()

  if (error || !state || state.boot_counter === null || state.boot_counter === undefined) {
    return null
  }

  const dbBootCounter = BigInt(state.boot_counter)
  const deviceBootCounter = BigInt(payload.bootCounter)
  if (dbBootCounter <= deviceBootCounter) return null

  if (state.boot_id === payload.bootId) {
    return dbBootCounter.toString()
  }

  const lastHbMs = state.last_heartbeat_received_at
    ? new Date(state.last_heartbeat_received_at).getTime()
    : null
  const receivedMs = new Date(receivedAt).getTime()
  const isPreviousSessionStale = lastHbMs === null
    || !Number.isFinite(lastHbMs)
    || (Number.isFinite(receivedMs) && (receivedMs - lastHbMs > env.IOT_HEARTBEAT_STALE_AFTER_MS))

  if (!isPreviousSessionStale) return null
  return (dbBootCounter + 1n).toString()
}

async function callIngestHeartbeatRpc(supabase, { sensor, machine, payload, bootCounter }) {
  const { data, error } = await supabase
    .rpc('ingest_iot_heartbeat', {
      p_heartbeat_id: payload.heartbeatId,
      p_sensor_id: sensor.id,
      p_machine_id: machine.id,
      p_boot_counter: bootCounter,
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

async function processHeartbeat({ sensor, machine, payload }) {
  const supabase = getSupabaseClient()
  const initialBootCounter = deviceBootCounterOverrides.get(payload.bootId) || payload.bootCounter
  const firstResult = await callIngestHeartbeatRpc(supabase, {
    sensor,
    machine,
    payload,
    bootCounter: initialBootCounter,
  })

  if (!firstResult.stale) {
    return firstResult
  }

  const overrideBootCounter = await resolveHeartbeatBootCounterOverride({
    supabase,
    sensorId: sensor.id,
    payload,
    receivedAt: firstResult.received_at,
  })
  if (!overrideBootCounter || overrideBootCounter === initialBootCounter) {
    return firstResult
  }

  rememberBootCounterOverride(payload.bootId, overrideBootCounter)
  return callIngestHeartbeatRpc(supabase, {
    sensor,
    machine,
    payload,
    bootCounter: overrideBootCounter,
  })
}

async function createHeartbeat({ sensor, payload }) {
  const machine = getMachineRecord(sensor)

  if (!machine) {
    throw createIotError(500, 'DEVICE_MACHINE_MISSING', 'ESP32 device is not assigned to a machine.')
  }

  const processing = await processHeartbeat({ sensor, machine, payload })
  if (processing.state_applied || (!processing.duplicate && processing.connectivity_state === 'offline')) {
    requestLiveStatusPublish()
  }
  return toHeartbeatResponse(processing, sensor)
}

module.exports = {
  createHeartbeat,
}
