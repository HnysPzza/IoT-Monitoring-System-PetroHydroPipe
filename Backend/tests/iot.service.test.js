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
    ...overrides,
  }
}

function createFakeSupabase({ sensorRecord, processingResult, rpcError, rpcCalls }) {
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
          return { data: rpcError ? null : processingResult, error: rpcError || null }
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
  rpcError = null,
  alertCalls = [],
  downtimeEvents = [],
  rpcCalls = [],
  sensorOverrides = {},
  alertError = null,
} = {}) {
  clearSourceCache()
  const sensorRecord = { ...createSensorRecord(), ...sensorOverrides }
  const processingResult = createProcessingResult(eventType, signal, processingOverrides)
  const fakeSupabase = createFakeSupabase({ sensorRecord, processingResult, rpcError, rpcCalls })

  mockModule('src/database/client.js', {
    getSupabaseClient: () => fakeSupabase,
  })
  mockModule('src/modules/audit/audit.service.js', {
    recordAuditLog: async (entry) => auditLogs.push(entry),
  })
  mockModule('src/modules/alerts/alerts.service.js', {
    createOrUpdateSensorAlert: async (entry) => {
      if (alertError) throw alertError
      alertCalls.push({ action: 'open', entry })
    },
    resolveAlertForSource: async (entry) => {
      if (alertError) throw alertError
      alertCalls.push({ action: 'resolve', entry })
    },
  })
  mockModule('src/modules/downtime/downtime.service.js', {
    publishDowntimeEvent: (type, downtime) => downtimeEvents.push({ type, downtime }),
  })

  return require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
}

async function createTestEvent(eventType, signal, options = {}) {
  const auditLogs = []
  const alertCalls = []
  const downtimeEvents = []
  const rpcCalls = []
  const iotService = loadIotService({ eventType, signal, auditLogs, alertCalls, downtimeEvents, rpcCalls, ...options })
  const event = await iotService.createSensorEvent({
    deviceId: 'esp32-m01-s01',
    deviceKey: 'device-secret',
    payload: {
      eventId: EVENT_ID,
      eventType,
      signal,
      recordedAt: '2026-06-11T00:00:00.000Z',
      metadata: {},
    },
  })

  return { alertCalls, auditLogs, downtimeEvents, event, rpcCalls }
}

test('pulse and idle events are processed atomically without noisy event audits', async () => {
  const pulse = await createTestEvent('pulse', 'active')
  const idle = await createTestEvent('idle', 'idle')

  assert.equal(pulse.event.stateApplied, true)
  assert.equal(pulse.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'), false)
  assert.equal(idle.auditLogs.some((entry) => entry.action === 'IOT_EVENT_RECEIVED'), false)
  assert.equal(pulse.rpcCalls[0].functionName, 'ingest_iot_sensor_event')
  assert.equal(pulse.rpcCalls[0].args.p_device_event_id, EVENT_ID)
})

test('important events record machine, downtime, and receipt audits from the transaction result', async () => {
  const result = await createTestEvent('downtime', 'no_pulse')

  assert.deepEqual(
    result.auditLogs.map((entry) => entry.action),
    ['IOT_MACHINE_STATUS_UPDATED', 'DOWNTIME_CREATED', 'IOT_EVENT_RECEIVED'],
  )
  assert.equal(result.alertCalls[0].action, 'open')
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
  assert.equal(duplicate.alertCalls.length, 0)
  assert.equal(duplicate.downtimeEvents.length, 0)
  assert.equal(stale.event.stale, true)
  assert.equal(stale.auditLogs[0].metadata.stateApplied, false)
  assert.equal(stale.alertCalls.length, 0)
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
      deviceId: 'esp32-m01-s01',
      deviceKey: 'device-secret',
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
      deviceId: 'esp32-m01-s01',
      deviceKey: 'device-secret',
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
    () => missingKeyService.createSensorEvent({
      deviceId: 'esp32-m01-s01',
      payload: { eventId: EVENT_ID, eventType: 'pulse', signal: 'active' },
    }),
    { code: 'DEVICE_UNAUTHORIZED', status: 401 },
  )

  const wrongKeyService = loadIotService({ eventType: 'pulse', signal: 'active' })
  await assert.rejects(
    () => wrongKeyService.createSensorEvent({
      deviceId: 'esp32-m01-s01',
      deviceKey: 'wrong-key',
      payload: { eventId: EVENT_ID, eventType: 'pulse', signal: 'active' },
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
      deviceId: 'esp32-m01-s01',
      deviceKey: 'device-secret',
      payload: { eventId: EVENT_ID, eventType: 'pulse', signal: 'active' },
    }),
    { code: 'DEVICE_MACHINE_MISSING', status: 500 },
  )
})

test('alert synchronization failure does not roll back a committed downtime transition', async () => {
  const result = await createTestEvent('downtime', 'no_pulse', {
    alertError: new Error('alert store unavailable'),
  })

  assert.equal(result.event.stateApplied, true)
  assert.equal(result.auditLogs.some((entry) => entry.action === 'DOWNTIME_CREATED'), true)
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
    createOrUpdateSensorAlert: async () => null,
    resolveAlertForSource: async () => null,
  })
  const service = require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))

  const feed = await service.getLiveFeed()

  assert.equal(feed.machine.activeSensors, 1)
  assert.equal(feed.machine.lastUpdated, '2026-06-11T00:02:00.000Z')
  assert.equal(feed.sensors[0].signal, 'active')
  assert.equal(feed.sensors[1].status, 'Idle')
})
