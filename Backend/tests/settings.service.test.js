const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const machineId = '10000000-0000-4000-8000-000000000001'
const actorId = '20000000-0000-4000-8000-000000000001'

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

function validThresholds() {
  return {
    'S-01': { absenceDetectionEnabled: false, triggerSeconds: 600, recoverySeconds: null },
    'S-02': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
    'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null },
    'S-04': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
    'S-05': { absenceDetectionEnabled: false, triggerSeconds: null, recoverySeconds: null },
  }
}

function validSchedule() {
  return {
    workStart: '08:00',
    workEnd: '17:00',
    breaks: [
      { name: 'Morning Break', startTime: '10:00', endTime: '10:15' },
      { name: 'Lunch Break', startTime: '12:00', endTime: '13:00' },
      { name: 'Afternoon Break', startTime: '15:00', endTime: '15:15' },
    ],
    rampUpGraceMinutes: 10,
  }
}

function settingsRow(overrides = {}) {
  return {
    machine_id: machineId,
    sensor_thresholds: validThresholds(),
    shift_schedule: validSchedule(),
    version: 1,
    updated_at: '2026-08-22T00:00:00.000Z',
    updated_by: null,
    ...overrides,
  }
}

function loadService({ tableResults = {}, rpcResult, calls = [] }) {
  clearSourceCache()
  const client = {
    from(table) {
      calls.push({ type: 'from', table })
      const builder = {
        select(columns) {
          calls.push({ type: 'select', table, columns })
          return builder
        },
        eq(column, value) {
          calls.push({ type: 'eq', table, column, value })
          return builder
        },
        async maybeSingle() {
          return tableResults[table]
        },
      }
      return builder
    },
    rpc(functionName, args) {
      calls.push({ type: 'rpc', functionName, args })
      return {
        async maybeSingle() {
          return rpcResult
        },
      }
    },
  }
  mockModule('src/database/client.js', { getSupabaseClient: () => client })
  return require(path.join(backendRoot, 'src', 'modules', 'settings', 'settings.service.js'))
}

function readableTables(row = settingsRow()) {
  return {
    machines: { data: { id: machineId }, error: null },
    machine_operational_settings: { data: row, error: null },
  }
}

test('settings read validates stored data and returns the public contract', async () => {
  const service = loadService({ tableResults: readableTables() })
  const result = await service.getMachineSettings(machineId)

  assert.deepEqual(result, {
    machineId,
    timeZone: 'Asia/Manila',
    sensorThresholds: validThresholds(),
    shiftSchedule: validSchedule(),
    version: '1',
    updatedAt: '2026-08-22T00:00:00.000Z',
    updatedBy: null,
  })
})

test('settings read distinguishes missing machine, missing settings, and query failures', async () => {
  const cases = [
    {
      tables: { machines: { data: null, error: null } },
      expected: { status: 404, code: 'MACHINE_NOT_FOUND' },
    },
    {
      tables: {
        machines: { data: { id: machineId }, error: null },
        machine_operational_settings: { data: null, error: null },
      },
      expected: { status: 500, code: 'SETTINGS_NOT_CONFIGURED' },
    },
    {
      tables: { machines: { data: null, error: { message: 'private machine error' } } },
      expected: { status: 500, code: 'SETTINGS_QUERY_FAILED' },
    },
    {
      tables: {
        machines: { data: { id: machineId }, error: null },
        machine_operational_settings: { data: null, error: { message: 'private settings error' } },
      },
      expected: { status: 500, code: 'SETTINGS_QUERY_FAILED' },
    },
  ]

  for (const item of cases) {
    const service = loadService({ tableResults: item.tables })
    await assert.rejects(() => service.getMachineSettings(machineId), item.expected)
  }
})

test('settings read fails closed on malformed stored documents and unsafe versions', async () => {
  const badThresholds = validThresholds()
  delete badThresholds['S-04']
  const malformedRows = [
    settingsRow({ sensor_thresholds: badThresholds }),
    settingsRow({ shift_schedule: { ...validSchedule(), workStart: '25:00' } }),
    settingsRow({ version: Number.MAX_SAFE_INTEGER + 1 }),
    settingsRow({ version: '01' }),
    settingsRow({ updated_at: null }),
    settingsRow({ updated_at: 'not-a-timestamp' }),
    settingsRow({ updated_by: 'not-a-uuid' }),
    settingsRow({ machine_id: actorId }),
  ]

  for (const row of malformedRows) {
    const service = loadService({ tableResults: readableTables(row) })
    await assert.rejects(
      () => service.getMachineSettings(machineId),
      { status: 500, code: 'SETTINGS_QUERY_FAILED' },
    )
  }
})

test('settings update merges sensor entries and delegates one atomic RPC', async () => {
  const calls = []
  const updatedThresholds = validThresholds()
  updatedThresholds['S-04'] = {
    absenceDetectionEnabled: true,
    triggerSeconds: 420,
    recoverySeconds: 20,
  }
  const service = loadService({
    calls,
    tableResults: readableTables(),
    rpcResult: { data: settingsRow({ sensor_thresholds: updatedThresholds, version: '2', updated_by: actorId }), error: null },
  })

  const result = await service.updateMachineSettings({
    machineId,
    expectedVersion: '1',
    sensorThresholds: { 'S-04': updatedThresholds['S-04'] },
    actorUserId: actorId,
  })

  assert.equal(result.version, '2')
  assert.deepEqual(result.sensorThresholds, updatedThresholds)
  const rpcCall = calls.find((call) => call.type === 'rpc')
  assert.deepEqual(rpcCall, {
    type: 'rpc',
    functionName: 'update_machine_operational_settings',
    args: {
      p_machine_id: machineId,
      p_expected_version: '1',
      p_sensor_thresholds: updatedThresholds,
      p_shift_schedule: validSchedule(),
      p_actor_user_id: actorId,
    },
  })
})

test('settings update replaces the complete shift section', async () => {
  const calls = []
  const replacement = { ...validSchedule(), rampUpGraceMinutes: 15 }
  const service = loadService({
    calls,
    tableResults: readableTables(),
    rpcResult: { data: settingsRow({ shift_schedule: replacement, version: 2 }), error: null },
  })

  await service.updateMachineSettings({
    machineId,
    expectedVersion: '1',
    shiftSchedule: replacement,
    actorUserId: actorId,
  })

  assert.deepEqual(calls.find((call) => call.type === 'rpc').args.p_shift_schedule, replacement)
})

test('settings activation rejects thresholds the heartbeat cadence cannot measure', async () => {
  const cases = [
    {
      threshold: { absenceDetectionEnabled: true, triggerSeconds: 5, recoverySeconds: 20 },
      code: 'WATCHDOG_TRIGGER_UNMEASURABLE',
    },
    {
      threshold: { absenceDetectionEnabled: true, triggerSeconds: 10, recoverySeconds: 10 },
      code: 'WATCHDOG_RECOVERY_UNMEASURABLE',
    },
  ]

  for (const item of cases) {
    const calls = []
    const service = loadService({ tableResults: readableTables(), calls })
    await assert.rejects(
      () => service.updateMachineSettings({
        machineId,
        expectedVersion: '1',
        sensorThresholds: { 'S-01': item.threshold },
        actorUserId: actorId,
      }),
      { status: 400, code: item.code },
    )
    assert.equal(calls.some((call) => call.type === 'rpc'), false)
  }
})

test('settings update maps database outcomes without exposing internal messages', async () => {
  const cases = [
    { error: { code: '40001', message: 'Settings version conflict.' }, expected: { status: 409, code: 'SETTINGS_VERSION_CONFLICT' } },
    { error: { code: 'P0002', message: 'internal machine detail' }, expected: { status: 404, code: 'MACHINE_NOT_FOUND' } },
    { error: { code: '55000', message: 'internal configuration detail' }, expected: { status: 500, code: 'SETTINGS_NOT_CONFIGURED' } },
    { error: { code: 'XX000', message: 'private database failure' }, expected: { status: 500, code: 'SETTINGS_UPDATE_FAILED' } },
  ]

  for (const item of cases) {
    const service = loadService({
      tableResults: readableTables(),
      rpcResult: { data: null, error: item.error },
    })
    await assert.rejects(
      () => service.updateMachineSettings({
        machineId,
        expectedVersion: '1',
        sensorThresholds: { 'S-01': validThresholds()['S-01'] },
        actorUserId: actorId,
      }),
      (error) => {
        assert.equal(error.status, item.expected.status)
        assert.equal(error.code, item.expected.code)
        assert.doesNotMatch(error.message, /private|internal/i)
        return true
      },
    )
  }
})

test('settings update rejects malformed or missing RPC results', async () => {
  for (const rpcResult of [
    { data: null, error: null },
    { data: settingsRow({ version: '01' }), error: null },
  ]) {
    const service = loadService({ tableResults: readableTables(), rpcResult })
    await assert.rejects(
      () => service.updateMachineSettings({
        machineId,
        expectedVersion: '1',
        sensorThresholds: { 'S-01': validThresholds()['S-01'] },
        actorUserId: actorId,
      }),
      { status: 500, code: 'SETTINGS_UPDATE_FAILED' },
    )
  }
})
