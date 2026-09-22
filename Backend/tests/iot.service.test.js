const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const bcrypt = require('bcryptjs')

const backendRoot = path.resolve(__dirname, '..')
const EVENT_ID = '11111111-1111-4111-8111-111111111111'

function clearSourceCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) {
      delete require.cache[cacheKey]
    }
  })
}

function mockModule(relativePath, exportsValue) {
  const modulePath = path.join(backendRoot, relativePath)
  require.cache[require.resolve(modulePath)] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsValue,
  }
}

function createSensorRecord() {
  return {
    id: 'sensor-1',
    sensor_code: 'S-01',
    esp32_device_id: 'esp32-m01-s01',
    label: 'Raw Material Detection',
    status: 'Active',
    device_key_hash: bcrypt.hashSync('device-secret', 4),
    machine_id: 'machine-1',
    machines: {
      id: 'machine-1',
      machine_code: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
      location: 'Production Floor',
    },
  }
}

function createProcessingResult(eventType, signal, overrides = {}) {
  const downtimeAction = eventType === 'fault'
    ? 'created'
    : eventType === 'recovered'
      ? 'resolved'
      : null
  const alertAction = eventType === 'fault'
    ? 'created'
    : eventType === 'recovered'
      ? 'resolved'
      : null

  const result = {
    sensor_event_id: `event-${eventType}`,
    device_event_id: EVENT_ID,
    event_type: eventType,
    event_value: { signal, metadata: {} },
    recorded_at: '2026-06-11T00:00:00.000Z',
    duplicate: false,
    stale: false,
    state_applied: true,
    previous_machine_status: 'Running',
    new_machine_status: eventType === 'fault' ? 'Downtime' : 'Running',
    downtime_action: downtimeAction,
    downtime_id: downtimeAction ? 'downtime-1' : null,
    downtime_sensor_code: downtimeAction ? 'S-03' : null,
    downtime_started_at: downtimeAction ? '2026-06-11T00:00:00.000Z' : null,
    downtime_ended_at: downtimeAction === 'resolved' ? '2026-06-11T00:10:00.000Z' : null,
    downtime_duration_seconds: downtimeAction === 'resolved' ? 600 : null,
    downtime_cause: downtimeAction ? 'Corrective Maintenance' : null,
    alert_action: alertAction,
    alert_record: alertAction
      ? {
        id: 'alert-1',
        status: alertAction === 'resolved' ? 'Resolved' : 'Active',
        revision: alertAction === 'resolved' ? '2' : '1',
      }
      : null,
    ...overrides,
  }

  if (!Object.hasOwn(overrides, 'transition_descriptors')) {
    result.transition_descriptors = result.state_applied
      ? [
        ...(result.downtime_action ? [{
          kind: 'downtime',
          action: result.downtime_action,
          id: result.downtime_id,
          sensorCode: result.downtime_sensor_code,
          machineCode: 'M-01',
        }] : []),
        ...(result.alert_action && result.alert_record ? [{
          kind: 'alert', action: result.alert_action, record: result.alert_record,
        }] : []),
      ]
      : []
  }

  return result
}

function createFakeSupabase({ sensorRecord, processingResult, rpcDataMissing, rpcError, rpcCalls }) {
  return {
    from(tableName) {
      assert.equal(tableName, 'sensors')
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          return { data: sensorRecord, error: null }
        },
      }
    },
    rpc(functionName, args) {
      rpcCalls.push({ functionName, args })
      return {
        async single() {
          return { data: rpcError || rpcDataMissing ? null : processingResult, error: rpcError || null }
        },
      }
    },
  }
}

function loadIotService({
  eventType,
  signal,
  auditLogs = [],
  processingOverrides = {},
  rpcDataMissing = false,
  rpcError = null,
  alertEvents = [],
  downtimeEvents = [],
  rpcCalls = [],
  sensorOverrides = {},
  alertPublishError = null,
  downtimePublishError = null,
  logs = [],
} = {}) {
  clearSourceCache()
  const sensorRecord = { ...createSensorRecord(), ...sensorOverrides }
  const processingResult = createProcessingResult(eventType, signal, processingOverrides)
  const fakeSupabase = createFakeSupabase({
    sensorRecord,
    processingResult,
    rpcDataMissing,
    rpcError,
    rpcCalls,
  })

  mockModule('src/database/client.js', {
    getSupabaseClient: () => fakeSupabase,
  })
  mockModule('src/modules/audit/audit.service.js', {
    recordAuditLog: async (entry) => auditLogs.push(entry),
  })
  mockModule('src/modules/alerts/alerts.service.js', {
    publishAlertAction: (action, alert) => {
      if (alertPublishError) throw alertPublishError
      alertEvents.push({ action, alert })
      return true
    },
  })
  mockModule('src/modules/downtime/downtime.service.js', {
    publishDowntimeEvent: (type, downtime) => {
      if (downtimePublishError) throw downtimePublishError
      downtimeEvents.push({ type, downtime })
      return true
    },
  })
  mockModule('src/utils/logger.js', {
    error: (code, metadata) => logs.push({ code, metadata }),
    info: () => {},
    warn: () => {},
  })

  return require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
}

async function createTestEvent(eventType, signal, options = {}) {
  const auditLogs = []
  const alertEvents = []
  const downtimeEvents = []
  const rpcCalls = []
  const logs = []
  const iotService = loadIotService({
    eventType,
    signal,
    auditLogs,
    alertEvents,
    downtimeEvents,
    rpcCalls,
    logs,
    ...options,
  })
  const event = await iotService.createSensorEvent({
    sensor: { ...createSensorRecord(), ...(options.sensorOverrides || {}) },
    payload: {
      eventId: EVENT_ID,
      eventType,
      signal,
      recordedAt: '2026-06-11T00:00:00.000Z',
      metadata: {},
    },
  })

  return { alertEvents, auditLogs, downtimeEvents, event, logs, rpcCalls }
}

test('pulse and idle events rely on the atomic RPC without secondary writes', async () => {
  const pulse = await createTestEvent('pulse', 'active')
  const idle = await createTestEvent('idle', 'idle')

  assert.equal(pulse.event.stateApplied, true)
  assert.equal(pulse.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'), false)
  assert.equal(idle.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'), false)
  assert.equal(pulse.alertEvents.length, 0)
  assert.equal(idle.downtimeEvents.length, 0)
  assert.equal(pulse.rpcCalls[0].functionName, 'ingest_iot_sensor_event')
  assert.equal(pulse.rpcCalls[0].args.p_device_event_id, EVENT_ID)
})

test('rejected S-05 output is returned without publishing transitions', async () => {
  const result = await createTestEvent('pulse', 'active', {
    sensorOverrides: { sensor_code: 'S-05' },
    processingOverrides: {
      state_applied: false,
      event_value: {
        signal: 'active',
        metadata: {
          outputAccepted: false,
          outputRejectionReason: 'machine_stationary',
        },
      },
    },
  })

  assert.equal(result.event.outputAccepted, false)
  assert.equal(result.event.outputRejectionReason, 'machine_stationary')
  assert.equal(result.alertEvents.length, 0)
  assert.equal(result.downtimeEvents.length, 0)
})

test('malformed S-05 output classification fails closed', async () => {
  await assert.rejects(
    () => createTestEvent('pulse', 'active', {
      sensorOverrides: { sensor_code: 'S-05' },
      processingOverrides: {
        event_value: {
          signal: 'active',
          metadata: {
            outputAccepted: true,
            outputRejectionReason: 'machine_stationary',
          },
        },
      },
    }),
    { code: 'SENSOR_EVENT_RESULT_INVALID', status: 500 },
  )
})

test('partial S-05 output classification fails closed', async () => {
  await assert.rejects(
    () => createTestEvent('pulse', 'active', {
      sensorOverrides: { sensor_code: 'S-05' },
      processingOverrides: {
        event_value: {
          signal: 'active',
          metadata: {
            outputRejectionReason: 'machine_stationary',
          },
        },
      },
    }),
    { code: 'SENSOR_EVENT_RESULT_INVALID', status: 500 },
  )
})

test('explicit faults publish committed downtime and alert transitions from one RPC result', async () => {
  const result = await createTestEvent('fault', 'fault')

  assert.equal(result.auditLogs.length, 0)
  assert.deepEqual(result.alertEvents, [{
    action: 'created',
    alert: {
      id: 'alert-1',
      status: 'Active',
      revision: '1',
    },
  }])
  assert.deepEqual(result.downtimeEvents, [{
    type: 'downtime.created',
    downtime: {
      id: 'downtime-1',
      status: 'Open',
      sensorCode: 'S-03',
      machineCode: 'M-01',
    },
  }])
  assert.equal(result.event.eventId, EVENT_ID)
})

test('grouped downtime responses and SSE transitions identify S-03 as the owner', async () => {
  const result = await createTestEvent('fault', 'fault', {
    processingOverrides: {
      downtime_id: 'downtime-group',
      downtime_sensor_code: 'S-03',
    },
  })

  assert.equal(result.event.downtimeAction, 'created')
  assert.equal(result.event.downtimeSensorCode, 'S-03')
  assert.equal(result.downtimeEvents[0].downtime.sensorCode, 'S-03')
})

test('ingestion publishes every committed descriptor in database order', async () => {
  const processAlert = { id: 'alert-s02', status: 'Active', revision: '3' }
  const downtimeAlert = { id: 'alert-s03', status: 'Active', revision: '4' }
  const result = await createTestEvent('fault', 'fault', {
    processingOverrides: {
      downtime_id: 'downtime-group',
      downtime_sensor_code: 'S-03',
      alert_action: 'created',
      alert_record: downtimeAlert,
      transition_descriptors: [
        { kind: 'alert', action: 'created', record: processAlert },
        { kind: 'downtime', action: 'created', id: 'downtime-group', sensorCode: 'S-03', machineCode: 'M-01' },
        { kind: 'alert', action: 'created', record: downtimeAlert },
      ],
    },
  })

  assert.deepEqual(result.alertEvents, [
    { action: 'created', alert: processAlert },
    { action: 'created', alert: downtimeAlert },
  ])
  assert.deepEqual(result.downtimeEvents, [{
    type: 'downtime.created',
    downtime: { id: 'downtime-group', status: 'Open', sensorCode: 'S-03', machineCode: 'M-01' },
  }])
  assert.equal(result.event.downtimeSensorCode, 'S-03')
})

test('malformed ingestion transition descriptors fail closed', async () => {
  const iotService = loadIotService({
    eventType: 'fault',
    signal: 'fault',
    processingOverrides: { transition_descriptors: null },
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: { eventId: EVENT_ID, eventType: 'fault', signal: 'fault' },
    }),
    { code: 'SENSOR_EVENT_RESULT_INVALID', status: 500 },
  )
})

test('no-pulse observations never publish downtime or alert transitions', async () => {
  const result = await createTestEvent('downtime', 'no_pulse')

  assert.equal(result.event.stateApplied, true)
  assert.equal(result.alertEvents.length, 0)
  assert.equal(result.downtimeEvents.length, 0)
})

test('duplicate and stale events never replay state transitions', async () => {
  const duplicate = await createTestEvent('downtime', 'no_pulse', {
    processingOverrides: { duplicate: true, state_applied: false, downtime_action: null },
  })
  const stale = await createTestEvent('recovered', 'active', {
    processingOverrides: { stale: true, state_applied: false, downtime_action: null },
  })

  assert.equal(duplicate.event.duplicate, true)
  assert.equal(duplicate.auditLogs.length, 0)
  assert.equal(duplicate.alertEvents.length, 0)
  assert.equal(duplicate.downtimeEvents.length, 0)
  assert.equal(stale.event.stale, true)
  assert.equal(stale.auditLogs.length, 0)
  assert.equal(stale.alertEvents.length, 0)
  assert.equal(stale.downtimeEvents.length, 0)
})

test('transaction failure is returned to the device instead of being swallowed', async () => {
  const iotService = loadIotService({
    eventType: 'downtime',
    signal: 'no_pulse',
    rpcError: { code: 'XX000', message: 'database unavailable' },
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: {
        eventId: EVENT_ID,
        eventType: 'downtime',
        signal: 'no_pulse',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: {},
      },
    }),
    { code: 'SENSOR_EVENT_PROCESSING_FAILED', status: 500 },
  )
})

test('an empty RPC result fails with a controlled processing error', async () => {
  const iotService = loadIotService({
    eventType: 'downtime',
    signal: 'no_pulse',
    rpcDataMissing: true,
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: {
        eventId: EVENT_ID,
        eventType: 'downtime',
        signal: 'no_pulse',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: {},
      },
    }),
    { code: 'SENSOR_EVENT_PROCESSING_FAILED', status: 500 },
  )
})

test('invalid timestamps or reused event IDs are rejected as client errors', async () => {
  const iotService = loadIotService({
    eventType: 'downtime',
    signal: 'no_pulse',
    rpcError: { code: '22023', message: 'invalid event' },
  })

  await assert.rejects(
    () => iotService.createSensorEvent({
      sensor: createSensorRecord(),
      payload: {
        eventId: EVENT_ID,
        eventType: 'downtime',
        signal: 'no_pulse',
        recordedAt: '2026-06-11T00:00:00.000Z',
        metadata: {},
      },
    }),
    { code: 'SENSOR_EVENT_REJECTED', status: 400 },
  )
})

test('device authentication rejects missing keys, wrong keys, and missing machines', async () => {
  const missingKeyService = loadIotService({ eventType: 'pulse', signal: 'active' })
  await assert.rejects(
    () => missingKeyService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  const wrongKeyService = loadIotService({ eventType: 'pulse', signal: 'active' })
  await assert.rejects(
    () => wrongKeyService.authenticateDevice({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key',
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  const missingMachineService = loadIotService({
    eventType: 'pulse',
    signal: 'active',
    sensorOverrides: { machines: null },
  })
  await assert.rejects(
    () => missingMachineService.createSensorEvent({
      sensor: { ...createSensorRecord(), machines: null },
      payload: { eventId: EVENT_ID, eventType: 'pulse', signal: 'active' },
    }),
    { code: 'DEVICE_MACHINE_MISSING', status: 500 },
  )
})

test('post-commit downtime and alert publication failures are isolated in both directions', async () => {
  const downtimeFailure = await createTestEvent('fault', 'fault', {
    downtimePublishError: new Error('downtime listener unavailable'),
  })
  assert.equal(downtimeFailure.event.stateApplied, true)
  assert.equal(downtimeFailure.alertEvents.length, 1)
  assert.equal(downtimeFailure.logs[0].code, 'DOWNTIME_SSE_PUBLISH_FAILED')

  const alertFailure = await createTestEvent('fault', 'fault', {
    alertPublishError: new Error('alert listener unavailable'),
  })
  assert.equal(alertFailure.event.stateApplied, true)
  assert.equal(alertFailure.downtimeEvents.length, 1)
  assert.equal(alertFailure.logs[0].code, 'ALERT_SSE_PUBLISH_FAILED')
})

function liveSnapshot(overrides = {}) {
  const snapshotAt = '2026-08-22T00:02:10.000Z'
  const sensors = ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'].map((sensorCode, index) => ({
    id: `10000000-0000-4000-8000-00000000000${index + 2}`,
    sensor_code: sensorCode,
    esp32_device_id: `device-${index + 1}`,
    label: `Sensor ${index + 1}`,
    status: index === 0 ? 'Active' : 'Inactive',
    updated_at: '2026-08-22T00:02:00.000Z',
    latest_event: index === 0 ? {
      id: '20000000-0000-4000-8000-000000000001',
      event_type: 'pulse',
      signal: 'active',
      recorded_at: '2026-08-22T00:02:00.000Z',
    } : null,
    watchdog: {
      connectivity_state: 'online',
      detection_state: index === 0 ? 'healthy' : 'disabled',
      last_heartbeat_received_at: '2026-08-22T00:02:05.000Z',
      last_activity_received_at: index === 0 ? '2026-08-22T00:02:00.000Z' : null,
      last_evaluated_at: '2026-08-22T00:02:05.000Z',
    },
  }))

  return {
    snapshot_at: snapshotAt,
    machine: {
      id: '10000000-0000-4000-8000-000000000001',
      machine_code: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
      location: 'Production Floor',
      updated_at: '2026-08-22T00:00:00.000Z',
    },
    sensors,
    ...overrides,
  }
}

function loadLiveFeedService({ data = liveSnapshot(), error = null, mode = 'observe', calls = [] } = {}) {
  clearSourceCache()
  const fakeSupabase = {
    rpc(functionName, args) {
      calls.push({ functionName, args })
      return {
        async single() {
          return { data, error }
        },
      }
    },
  }

  mockModule('src/database/client.js', { getSupabaseClient: () => fakeSupabase })
  mockModule('src/config/env.js', {
    WATCHDOG_MODE: mode,
    WATCHDOG_TICK_INTERVAL_MS: 15000,
    WATCHDOG_EVALUATION_TIMEOUT_MS: 10000,
  })
  mockModule('src/modules/audit/audit.service.js', { recordAuditLog: async () => null })
  mockModule('src/modules/operations/transitionPublisher.js', { publishIngestionTransitions: () => null })
  return require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
}

test('live feed uses one snapshot RPC and returns fresh monitoring state', async () => {
  const calls = []
  const service = loadLiveFeedService({ calls })
  const feed = await service.getLiveFeed()

  assert.deepEqual(calls, [{
    functionName: 'get_machine_live_snapshot',
    args: { p_machine_code: 'M-01' },
  }])
  assert.equal(feed.monitoring.mode, 'observe')
  assert.equal(feed.machine.activeSensors, 1)
  assert.equal(feed.machine.lastUpdated, '2026-08-22T00:02:00.000Z')
  assert.equal(feed.sensors[0].signal, 'active')
  assert.equal(feed.sensors[0].monitoring.stateFresh, true)
  assert.equal(feed.sensors[0].monitoring.detectionState, 'healthy')
  assert.equal(feed.sensors[1].status, 'Idle')
})

test('live feed masks watchdog states when monitoring is disabled or stale', async () => {
  const disabled = await loadLiveFeedService({ mode: 'disabled' }).getLiveFeed()
  assert.equal(disabled.sensors[0].monitoring.stateFresh, false)
  assert.equal(disabled.sensors[0].monitoring.connectivityState, null)
  assert.equal(disabled.sensors[0].monitoring.detectionState, null)

  const snapshot = liveSnapshot()
  snapshot.sensors[0].watchdog.last_evaluated_at = '2026-08-22T00:00:00.000Z'
  const stale = await loadLiveFeedService({ data: snapshot }).getLiveFeed()
  assert.equal(stale.sensors[0].monitoring.stateFresh, false)
  assert.equal(stale.sensors[0].monitoring.detectionState, null)
})

test('live feed keeps a single process sensor fault distinct from downtime', async () => {
  const snapshot = liveSnapshot()
  snapshot.sensors[0].status = 'Fault'
  const feed = await loadLiveFeedService({ data: snapshot }).getLiveFeed()

  assert.equal(feed.machine.status, 'Running')
  assert.equal(feed.sensors[0].status, 'Fault')
})

test('live feed keeps S-03 physical input separate from machine downtime authority', async () => {
  const snapshot = liveSnapshot({ machine: { ...liveSnapshot().machine, status: 'Downtime' } })
  snapshot.sensors[2].status = 'Active'

  const feed = await loadLiveFeedService({ data: snapshot }).getLiveFeed()
  const s03 = feed.sensors.find((sensor) => sensor.sensorCode === 'S-03')

  assert.equal(feed.machine.status, 'Downtime')
  assert.equal(s03.status, 'Downtime')
  assert.equal(s03.physicalStatus, 'Active')
})

test('live feed fails closed on database and malformed snapshot results', async () => {
  await assert.rejects(
    () => loadLiveFeedService({ error: { code: 'XX000', message: 'private database detail' } }).getLiveFeed(),
    { status: 500, code: 'LIVE_SNAPSHOT_QUERY_FAILED' },
  )
  await assert.rejects(
    () => loadLiveFeedService({ data: { private: 'invalid' } }).getLiveFeed(),
    { status: 500, code: 'LIVE_SNAPSHOT_INVALID' },
  )
})
