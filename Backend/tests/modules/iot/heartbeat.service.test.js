const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '../../..')
const heartbeatId = '50000000-0000-4000-8000-000000000001'

function clearSourceCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) delete require.cache[cacheKey]
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

function sensorRecord(overrides = {}) {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    sensor_code: 'S-01',
    machines: { id: '10000000-0000-4000-8000-000000000001', machine_code: 'M-01' },
    ...overrides,
  }
}

function heartbeatPayload(overrides = {}) {
  return {
    heartbeatId,
    bootId: '40000000-0000-4000-8000-000000000001',
    bootCounter: '1',
    sequence: '1',
    recordedAt: '2026-08-22T03:00:00.000Z',
    activityObserved: true,
    ...overrides,
  }
}

function loadService({ data, error = null, calls = [], liveStatusRequests = [] } = {}) {
  clearSourceCache()
  const client = {
    rpc(functionName, args) {
      calls.push({ functionName, args })
      return { async single() { return { data, error } } }
    },
  }
  mockModule('src/database/client.js', { getSupabaseClient: () => client })
  mockModule('src/modules/audit/audit.service.js', { recordAuditLog: async () => null })
  mockModule('src/modules/alerts/alerts.service.js', { publishAlertAction: () => true })
  mockModule('src/modules/downtime/downtime.service.js', { publishDowntimeEvent: () => true })
  mockModule('src/modules/iot/liveStatusPublisher.js', { requestLiveStatusPublish: () => liveStatusRequests.push(true) })
  return require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))
}

function validResult(overrides = {}) {
  return {
    heartbeat_id: heartbeatId,
    duplicate: false,
    stale: false,
    state_applied: true,
    received_at: '2026-08-22T03:00:00.100Z',
    connectivity_state: 'online',
    ...overrides,
  }
}

test('heartbeat service sends decimal strings to one atomic RPC and maps its contract', async () => {
  const calls = []
  const service = loadService({ data: validResult(), calls })
  const result = await service.createHeartbeat({ sensor: sensorRecord(), payload: heartbeatPayload() })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].functionName, 'ingest_iot_heartbeat')
  assert.equal(calls[0].args.p_boot_counter, '1')
  assert.equal(calls[0].args.p_sequence, '1')
  assert.deepEqual(result, {
    heartbeatId,
    sensorCode: 'S-01',
    machineCode: 'M-01',
    receivedAt: '2026-08-22T03:00:00.100Z',
    connectivityState: 'online',
    duplicate: false,
    stale: false,
    stateApplied: true,
  })
})

test('heartbeat service accepts exactly one applied, duplicate, or stale outcome', async () => {
  for (const outcome of [
    validResult(),
    validResult({ duplicate: true, state_applied: false }),
    validResult({ stale: true, state_applied: false }),
  ]) {
    const result = await loadService({ data: outcome }).createHeartbeat({
      sensor: sensorRecord(),
      payload: heartbeatPayload(),
    })
    assert.equal(Number(result.duplicate) + Number(result.stale) + Number(result.stateApplied), 1)
  }
})

test('heartbeat service fails closed on malformed RPC results and missing machine assignment', async () => {
  for (const data of [
    null,
    validResult({ heartbeat_id: 'wrong' }),
    validResult({ received_at: 'not-a-date' }),
    validResult({ connectivity_state: 'Fault' }),
    validResult({ duplicate: true }),
  ]) {
    const service = loadService({ data })
    await assert.rejects(
      () => service.createHeartbeat({ sensor: sensorRecord(), payload: heartbeatPayload() }),
      { status: 500, code: 'HEARTBEAT_PROCESSING_FAILED' },
    )
  }

  const service = loadService({ data: validResult() })
  await assert.rejects(
    () => service.createHeartbeat({ sensor: sensorRecord({ machines: null }), payload: heartbeatPayload() }),
    { status: 500, code: 'DEVICE_MACHINE_MISSING' },
  )
})

test('heartbeat service maps validation, conflict, and database errors without exposing details', async () => {
  const cases = [
    [{ code: '22023', message: 'private' }, { status: 400, code: 'HEARTBEAT_REJECTED' }],
    [{ code: '23505', message: 'private' }, { status: 409, code: 'HEARTBEAT_CONFLICT' }],
    [{ code: 'XX000', message: 'private' }, { status: 500, code: 'HEARTBEAT_PROCESSING_FAILED' }],
  ]

  for (const [error, expected] of cases) {
    const service = loadService({ error })
    await assert.rejects(
      () => service.createHeartbeat({ sensor: sensorRecord(), payload: heartbeatPayload() }),
      expected,
    )
  }
})

test('applied heartbeat requests a live status publish', async () => {
  const liveStatusRequests = []
  const service = loadService({ data: validResult(), liveStatusRequests })
  await service.createHeartbeat({ sensor: sensorRecord(), payload: heartbeatPayload() })

  assert.equal(liveStatusRequests.length, 1)
})

test('duplicate or stale heartbeat does not request a live status publish', async () => {
  for (const outcome of [
    validResult({ duplicate: true, state_applied: false }),
    validResult({ stale: true, state_applied: false }),
  ]) {
    const liveStatusRequests = []
    const service = loadService({ data: outcome, liveStatusRequests })
    await service.createHeartbeat({ sensor: sensorRecord(), payload: heartbeatPayload() })

    assert.equal(liveStatusRequests.length, 0)
  }
})

test('heartbeat service rescues device boot counter when prior DB session is stale with higher boot counter', async () => {
  clearSourceCache()
  const calls = []
  const liveStatusRequests = []
  const client = {
    from(tableName) {
      assert.equal(tableName, 'sensor_watchdog_state')
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() {
          return {
            data: {
              boot_counter: 999,
              boot_id: '40000000-0000-4000-8000-000000000099',
              last_heartbeat_received_at: '2026-08-22T02:58:00.000Z',
            },
            error: null,
          }
        },
      }
    },
    rpc(functionName, args) {
      calls.push({ functionName, args })
      const isOverride = args.p_boot_counter === '1000'
      return {
        async single() {
          return {
            data: isOverride
              ? validResult({ state_applied: true, stale: false, connectivity_state: 'online' })
              : validResult({ state_applied: false, stale: true, connectivity_state: 'offline' }),
            error: null,
          }
        },
      }
    },
  }
  mockModule('src/database/client.js', { getSupabaseClient: () => client })
  mockModule('src/modules/audit/audit.service.js', { recordAuditLog: async () => null })
  mockModule('src/modules/alerts/alerts.service.js', { publishAlertAction: () => true })
  mockModule('src/modules/downtime/downtime.service.js', { publishDowntimeEvent: () => true })
  mockModule('src/modules/iot/liveStatusPublisher.js', { requestLiveStatusPublish: () => liveStatusRequests.push(true) })
  const service = require(path.join(backendRoot, 'src', 'modules', 'iot', 'iot.service.js'))

  const result = await service.createHeartbeat({ sensor: sensorRecord(), payload: heartbeatPayload({ bootCounter: '3' }) })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].args.p_boot_counter, '3')
  assert.equal(calls[1].args.p_boot_counter, '1000')
  assert.equal(result.stateApplied, true)
  assert.equal(result.connectivityState, 'online')
  assert.equal(liveStatusRequests.length, 1)
})
