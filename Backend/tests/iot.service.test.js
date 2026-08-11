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
  const downtimeAction = eventType === 'downtime' || eventType === 'fault'
    ? 'created'
    : eventType === 'recovered'
      ? 'resolved'
      : null
  const alertAction = eventType === 'downtime' || eventType === 'fault'
    ? 'created'
    : eventType === 'recovered'
      ? 'resolved'
      : null

  return {
    sensor_event_id: `event-${eventType}`,
    device_event_id: EVENT_ID,
    event_type: eventType,
    event_value: { signal, metadata: {} },
    recorded_at: '2026-06-11T00:00:00.000Z',
    duplicate: false,
    stale: false,
    state_applied: true,
    previous_machine_status: 'Running',
    new_machine_status: eventType === 'downtime' || eventType === 'fault' ? 'Downtime' : 'Running',
    downtime_action: downtimeAction,
    downtime_id: downtimeAction ? 'downtime-1' : null,
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

test('important events publish committed downtime and alert transitions from one RPC result', async () => {
  const result = await createTestEvent('downtime', 'no_pulse')

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
      sensorCode: 'S-01',
      machineCode: 'M-01',
    },
  }])
  assert.equal(result.event.eventId, EVENT_ID)
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
  const downtimeFailure = await createTestEvent('downtime', 'no_pulse', {
    downtimePublishError: new Error('downtime listener unavailable'),
  })
  assert.equal(downtimeFailure.event.stateApplied, true)
  assert.equal(downtimeFailure.alertEvents.length, 1)
  assert.equal(downtimeFailure.logs[0].code, 'DOWNTIME_SSE_PUBLISH_FAILED')

  const alertFailure = await createTestEvent('downtime', 'no_pulse', {
    alertPublishError: new Error('alert listener unavailable'),
  })
  assert.equal(alertFailure.event.stateApplied, true)
  assert.equal(alertFailure.downtimeEvents.length, 1)
  assert.equal(alertFailure.logs[0].code, 'ALERT_SSE_PUBLISH_FAILED')
})

test('live feed returns machine state and the latest event for each sensor', async () => {
  clearSourceCache()
  const machine = {
    id: 'machine-1',
    machine_code: 'M-01',
    name: 'Spiral Mill 01',
    status: 'Running',
    location: 'Production Floor',
    updated_at: '2026-06-11T00:00:00.000Z',
  }
  const sensors = [
    { id: 'sensor-1', sensor_code: 'S-01', esp32_device_id: 'device-1', label: 'Raw Material Detection', status: 'Active' },
    { id: 'sensor-2', sensor_code: 'S-02', esp32_device_id: 'device-2', label: 'Outside Filler', status: 'Inactive' },
  ]
  const events = [
    { id: 'event-2', sensor_id: 'sensor-1', event_type: 'pulse', event_value: { signal: 'active' }, recorded_at: '2026-06-11T00:02:00.000Z' },
    { id: 'event-1', sensor_id: 'sensor-1', event_type: 'idle', event_value: { signal: 'idle' }, recorded_at: '2026-06-11T00:01:00.000Z' },
  ]
  const fakeSupabase = {
    from(tableName) {
      return {
        select() { return this },
        eq() { return this },
        in() { return this },
        order() { return this },
        limit() { return this },
        async maybeSingle() {
          return { data: tableName === 'machines' ? machine : null, error: null }
        },
        then(resolve, reject) {
          const data = tableName === 'sensors' ? sensors : tableName === 'sensor_events' ? events : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
    },
  }

  mockModule('src/database/client.js', { getSupabaseClient: () => fakeSupabase })
  mockModule('src/modules/audit/audit.service.js', { recordAuditLog: async () => null })
  mockModule('src/modules/alerts/alerts.service.js', {
    publishAlertAction: () => true,
  })
  const service = require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))

  const feed = await service.getLiveFeed()

  assert.equal(feed.machine.activeSensors, 1)
  assert.equal(feed.machine.lastUpdated, '2026-06-11T00:02:00.000Z')
  assert.equal(feed.sensors[0].signal, 'active')
  assert.equal(feed.sensors[1].status, 'Idle')
})
