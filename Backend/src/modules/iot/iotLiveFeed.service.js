const { z } = require('zod')
const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const { getSensorLabel, getSensorPurpose } = require('../../shared/sensorIdentity')
const { createIotError } = require('./iot.helpers')

const MAX_EVALUATION_CLOCK_SKEW_MS = 5_000
const PROCESS_SENSOR_CODES = new Set(['S-01', 'S-02', 'S-04'])

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

function mapSensorStatusToLiveStatus(sensorCode, status, machineStatus) {
  if (sensorCode === 'S-03' && machineStatus === 'Downtime') return 'Downtime'
  if (sensorCode === 'S-05') return status === 'Active' ? 'Running' : 'Idle'
  if (status === 'Active') return 'Running'
  if (status === 'Fault') return 'Fault'
  return 'Idle'
}

function isMonitoringStateFresh(snapshotAt, lastEvaluatedAt) {
  if (env.WATCHDOG_MODE === 'disabled' || !lastEvaluatedAt) return false
  const age = new Date(snapshotAt).getTime() - new Date(lastEvaluatedAt).getTime()
  const maximumAge = (env.WATCHDOG_TICK_INTERVAL_MS * 2) + env.WATCHDOG_EVALUATION_TIMEOUT_MS
  return age >= -MAX_EVALUATION_CLOCK_SKEW_MS && age <= maximumAge
}

function resolveConnectivityState(snapshotAt, sensorRecord) {
  const watchdog = sensorRecord.watchdog
  if (!watchdog?.last_heartbeat_received_at) return null
  const age = Date.parse(snapshotAt) - Date.parse(watchdog.last_heartbeat_received_at)
  if (!Number.isFinite(age)) return null
  if (age > env.IOT_HEARTBEAT_STALE_AFTER_MS) return 'offline'
  return watchdog.connectivity_state === 'unknown' ? null : watchdog.connectivity_state
}

function hasFreshActiveProcessSignal(sensorRecord, snapshotAt, connectivityState) {
  if (!PROCESS_SENSOR_CODES.has(sensorRecord.sensor_code)) return false
  if (sensorRecord.status === 'Fault' || connectivityState !== 'online') return false
  if (sensorRecord.latest_event?.signal !== 'active') return false

  const snapshotMs = new Date(snapshotAt).getTime()
  const activityTimestamp = sensorRecord.watchdog?.last_activity_received_at || sensorRecord.latest_event?.recorded_at
  const activityMs = activityTimestamp ? new Date(activityTimestamp).getTime() : NaN
  if (!Number.isFinite(snapshotMs) || !Number.isFinite(activityMs)) return false

  const heartbeatMs = sensorRecord.watchdog?.last_heartbeat_received_at
    ? new Date(sensorRecord.watchdog.last_heartbeat_received_at).getTime()
    : NaN
  if (Number.isFinite(heartbeatMs) && heartbeatMs > activityMs + 1000) return false

  const maxActiveWindowMs = Math.max((env.IOT_HEARTBEAT_EXPECTED_INTERVAL_MS || 10_000) * 1.5, 15_000)
  const ageMs = snapshotMs - activityMs
  return ageMs >= -MAX_EVALUATION_CLOCK_SKEW_MS && ageMs <= maxActiveWindowMs
}

function toLiveSensorResponse(sensorRecord, snapshotAt, machineStatus) {
  const stateFresh = isMonitoringStateFresh(snapshotAt, sensorRecord.watchdog?.last_evaluated_at)
  const connectivityState = resolveConnectivityState(snapshotAt, sensorRecord)
  const activeProcessSignal = hasFreshActiveProcessSignal(sensorRecord, snapshotAt, connectivityState)
  const physicalStatus = activeProcessSignal ? 'Active' : sensorRecord.status

  let detectionState = stateFresh ? sensorRecord.watchdog.detection_state : null
  if (stateFresh && PROCESS_SENSOR_CODES.has(sensorRecord.sensor_code)) {
    if (activeProcessSignal && detectionState === 'grace') {
      detectionState = 'healthy'
    } else if (
      physicalStatus === 'Inactive'
      && sensorRecord.latest_event?.signal === 'idle'
      && detectionState === 'healthy'
    ) {
      detectionState = 'grace'
    }
  }

  return {
    id: sensorRecord.id,
    sensorCode: sensorRecord.sensor_code,
    label: getSensorLabel(sensorRecord.sensor_code, sensorRecord.label),
    esp32DeviceId: sensorRecord.esp32_device_id,
    status: mapSensorStatusToLiveStatus(sensorRecord.sensor_code, physicalStatus, machineStatus),
    physicalStatus,
    signal: sensorRecord.latest_event?.signal || null,
    lastEventAt: sensorRecord.latest_event?.recorded_at || null,
    purpose: getSensorPurpose(sensorRecord.sensor_code),
    monitoring: {
      stateFresh,
      connectivityState,
      detectionState,
      lastHeartbeatAt: sensorRecord.watchdog?.last_heartbeat_received_at || null,
      lastActivityAt: sensorRecord.watchdog?.last_activity_received_at || null,
      lastEvaluatedAt: sensorRecord.watchdog?.last_evaluated_at || null,
    },
  }
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
  getLiveFeed,
}
