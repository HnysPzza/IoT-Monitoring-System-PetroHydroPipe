const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { addBusinessDays, startOfBusinessDay } = require('../src/shared/businessTime')

const backendRoot = path.resolve(__dirname, '..')
const MACHINE_ID = '11111111-1111-4111-8111-111111111111'

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

function createMachineClient() {
  return {
    from(tableName) {
      return {
        select() { return this },
        eq() { return this },
        order() {
          return Promise.resolve({ data: [], error: null })
        },
        maybeSingle() {
          if (tableName === 'machines') {
            return Promise.resolve({
              data: { id: MACHINE_ID, machine_code: 'M-01', name: 'Spiral Mill 01', status: 'Running' },
              error: null,
            })
          }
          throw new Error(`Unexpected maybeSingle query for ${tableName}`)
        },
      }
    },
  }
}

function createProductionClient(events, queryLog) {
  return {
    rpc(functionName, args) {
      assert.equal(functionName, 'aggregate_analytics_sensor_events')
      queryLog.push({ functionName, args })
      return Promise.resolve({ data: events, error: null })
    },
    from(tableName) {
      if (tableName === 'production_counts') {
        throw new Error('Production comparison must use S-05 pulse events as its single source of truth.')
      }

      return {
        select() { return this },
        eq() { return this },
        order() {
          return Promise.resolve({
            data: [
              { id: 'sensor-1', sensor_code: 'S-01', status: 'Running', label: 'Raw Material and Coil Joint' },
              { id: 'sensor-5', sensor_code: 'S-05', status: 'Running', label: 'Output Cutting' },
            ],
            error: null,
          })
        },
        maybeSingle() {
          if (tableName === 'machines') {
            return Promise.resolve({
              data: { id: MACHINE_ID, machine_code: 'M-01', name: 'Spiral Mill 01', status: 'Running' },
              error: null,
            })
          }

          throw new Error(`Unexpected maybeSingle query for ${tableName}`)
        },
      }
    },
  }
}

async function getOverviewWithProductionEvents(events, queryLog = []) {
  clearSourceCache()
  const settingsHistory = [{
    machine_id: MACHINE_ID,
    version: '1',
    shift_schedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 },
    effective_from: null,
    effective_to: null,
  }]

  mockModule('src/database/client.js', {
    getSupabaseClient: () => createProductionClient(events, queryLog),
  })
  mockModule('src/modules/downtime/downtime.repository.js', {
    getOverlappingDowntime: async () => [],
  })
  mockModule('src/modules/settings/settingsHistory.repository.js', {
    getSettingsHistory: async () => settingsHistory,
  })

  return require('../src/modules/dashboard/dashboard.service').getOverview()
}

test('dashboard downtime impact includes pre-window events and uses break-aware unplanned loss', async () => {
  clearSourceCache()
  const repositoryCalls = []
  const settingsHistory = [{
    machine_id: MACHINE_ID,
    version: '1',
    shift_schedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 },
    effective_from: null,
    effective_to: null,
  }]
  mockModule('src/database/client.js', { getSupabaseClient: createMachineClient })
  mockModule('src/modules/downtime/downtime.repository.js', {
    getOverlappingDowntime: async (machineId, window) => {
      repositoryCalls.push({ machineId, window })
      return [{
        id: 'down-1',
        machine_id: MACHINE_ID,
        started_at: '2026-08-08T15:30:00.000Z',
        ended_at: '2026-08-09T00:30:00.000Z',
        cause: 'Flux Refill',
        status: 'Resolved',
        sensors: { sensor_code: 'S-01' },
      }]
    },
  })
  mockModule('src/modules/settings/settingsHistory.repository.js', {
    getSettingsHistory: async () => settingsHistory,
  })
  const dashboardService = require('../src/modules/dashboard/dashboard.service')

  const result = await dashboardService.getDowntimeImpact({ trendMode: 'today', date: '2026-08-09' })
  const sixToNineAm = result.points.find((point) => point.label === '6-9AM')

  assert.equal(repositoryCalls[0].machineId, MACHINE_ID)
  assert.equal(repositoryCalls[0].window.start.toISOString(), '2026-08-08T16:00:00.000Z')
  assert.deepEqual(sixToNineAm, {
    label: '6-9AM',
    periodState: 'completed',
    minutes: 150,
    unplannedMinutes: 30,
    plannedExcludedMinutes: 120,
    estimatedLoss: 69,
    cause: 'Flux Refill',
    causeReviewPending: false,
  })
})

test('current-day downtime appears only in its interval and future periods remain unobserved', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-08-25T07:39:00+08:00'),
  })
  clearSourceCache()
  const settingsHistory = [{
    machine_id: MACHINE_ID,
    version: '1',
    shift_schedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 },
    effective_from: null,
    effective_to: null,
  }]
  mockModule('src/database/client.js', { getSupabaseClient: createMachineClient })
  mockModule('src/modules/downtime/downtime.repository.js', {
    getOverlappingDowntime: async () => [{
      id: 'down-morning',
      machine_id: MACHINE_ID,
      started_at: '2026-08-24T23:23:00.000Z',
      ended_at: '2026-08-24T23:31:00.000Z',
      cause: 'Pending Cause Review',
      status: 'Resolved',
      sensors: { sensor_code: 'S-03' },
    }],
  })
  mockModule('src/modules/settings/settingsHistory.repository.js', {
    getSettingsHistory: async () => settingsHistory,
  })
  const dashboardService = require('../src/modules/dashboard/dashboard.service')

  const result = await dashboardService.getDowntimeImpact({ trendMode: 'today', date: '2026-08-25' })

  assert.deepEqual(
    result.points.map(({ label, periodState, minutes }) => ({ label, periodState, minutes })),
    [
      { label: '12-6AM', periodState: 'completed', minutes: 0 },
      { label: '6-9AM', periodState: 'current', minutes: 8 },
      { label: '9AM-12PM', periodState: 'future', minutes: null },
      { label: '12-3PM', periodState: 'future', minutes: null },
      { label: '3-6PM', periodState: 'future', minutes: null },
      { label: '6-9PM', periodState: 'future', minutes: null },
    ],
  )
  assert.equal(result.points[1].cause, null)
  assert.equal(result.points[1].causeReviewPending, true)
})

test('overview compares today with the same elapsed portion of yesterday using only S-05 pulse events', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-25T10:30:00+08:00') })
  const todayStart = startOfBusinessDay(new Date())
  const yesterdayStart = addBusinessDays(todayStart, -1)
  const atHour = (start, hour) => new Date(start.getTime() + (hour * 60 * 60 * 1000)).toISOString()
  const queryLog = []
  const events = [
    ...[1, 2, 3].map((hour) => ({ bucket_start: atHour(yesterdayStart, hour), sensor_code: 'S-05', event_count: 1 })),
    { bucket_start: atHour(yesterdayStart, 20), sensor_code: 'S-05', event_count: 40 },
    ...[1, 2, 3, 4, 5].map((hour) => ({ bucket_start: atHour(todayStart, hour), sensor_code: 'S-05', event_count: 1 })),
    { bucket_start: atHour(todayStart, 1), sensor_code: 'S-01', event_count: 99 },
  ]

  const result = await getOverviewWithProductionEvents(events, queryLog)
  const comparison = result.productionAnalytics.day

  assert.deepEqual(Object.keys(result.productionAnalytics), ['day'])
  assert.equal(comparison.label, 'Today so far vs Yesterday at same time')
  assert.equal(comparison.currentTotal, 5)
  assert.equal(comparison.previousTotal, 3)
  assert.equal(comparison.difference, 2)
  assert.equal(comparison.differencePercent, 66.67)
  assert.equal(comparison.unit, 'pcs')
  assert.equal(Object.hasOwn(comparison, 'targetTotal'), false)
  assert.equal(comparison.points.every((point) => !Object.hasOwn(point, 'target')), true)
  assert.deepEqual(comparison.points.map(({ periodState, current, previous }) => ({ periodState, current, previous })), [
    { periodState: 'completed', current: 5, previous: 3 },
    { periodState: 'completed', current: 5, previous: 3 },
    { periodState: 'current', current: 5, previous: 3 },
    { periodState: 'future', current: null, previous: null },
    { periodState: 'future', current: null, previous: null },
    { periodState: 'future', current: null, previous: null },
  ])
  assert.match(result.summary[0].value, /5 pcs/)
  assert.deepEqual(queryLog, [{
    functionName: 'aggregate_analytics_sensor_events',
    args: {
      p_machine_id: MACHINE_ID,
      p_started_at: yesterdayStart.toISOString(),
      p_ended_at: new Date('2026-08-25T10:30:00+08:00').toISOString(),
      p_bucket_seconds: 3600,
    },
  }])
})

test('overview returns no percentage when yesterday has no production baseline', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-25T10:30:00+08:00') })
  const todayStart = startOfBusinessDay(new Date())
  const events = [{
    bucket_start: new Date(todayStart.getTime() + 3600000).toISOString(),
    sensor_code: 'S-05',
    event_count: 1,
  }]

  const result = await getOverviewWithProductionEvents(events)

  assert.equal(result.productionAnalytics.day.currentTotal, 1)
  assert.equal(result.productionAnalytics.day.previousTotal, 0)
  assert.equal(result.productionAnalytics.day.difference, 1)
  assert.equal(result.productionAnalytics.day.differencePercent, null)
})

test('overview counts more than 1000 output pulses without row truncation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-25T10:30:00+08:00') })
  const todayStart = startOfBusinessDay(new Date())
  const events = [{
    bucket_start: new Date(todayStart.getTime() + 3600000).toISOString(),
    sensor_code: 'S-05',
    event_count: 1005,
  }]

  const result = await getOverviewWithProductionEvents(events)

  assert.equal(result.productionAnalytics.day.currentTotal, 1005)
  assert.match(result.summary[0].value, /1,005 pcs/)
})
