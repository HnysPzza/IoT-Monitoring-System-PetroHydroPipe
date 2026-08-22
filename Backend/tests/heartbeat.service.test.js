const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
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

function loadService({ data, error = null, calls = [] } = {}) {
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
