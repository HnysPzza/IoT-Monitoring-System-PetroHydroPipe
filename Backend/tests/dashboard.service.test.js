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
    from(tableName) {
      if (tableName === 'production_counts') {
        throw new Error('Production comparison must use S-05 pulse events as its single source of truth.')
      }

      const filters = []
      let selectedColumns = ''

      return {
        select(columns) {
          selectedColumns = columns
          return this
        },
        eq(column, value) {
          filters.push({ column, value })
          return this
        },
        gte(column, value) {
          queryLog.push({ operator: 'gte', tableName, column, value })
          return this
        },
        lt(column, value) {
          queryLog.push({ operator: 'lt', tableName, column, value })
          return Promise.resolve({ data: events, error: null })
        },
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

          if (tableName === 'sensors' && selectedColumns === 'id') {
            assert.deepEqual(filters, [
              { column: 'machine_id', value: MACHINE_ID },
              { column: 'sensor_code', value: 'S-05' },
            ])
            return Promise.resolve({ data: { id: 'sensor-5' }, error: null })
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
  const nineAm = result.points.find((point) => point.label === '9AM')

  assert.equal(repositoryCalls[0].machineId, MACHINE_ID)
  assert.equal(repositoryCalls[0].window.start.toISOString(), '2026-08-08T16:00:00.000Z')
  assert.deepEqual(nineAm, {
    label: '9AM',
    minutes: 510,
    unplannedMinutes: 30,
    plannedExcludedMinutes: 480,
    estimatedLoss: 69,
    cause: 'Flux Refill',
  })
})

test('overview compares today with yesterday using only S-05 pulse events', async () => {
  const todayStart = startOfBusinessDay(new Date())
  const yesterdayStart = addBusinessDays(todayStart, -1)
  const tomorrowStart = addBusinessDays(todayStart, 1)
  const atHour = (start, hour) => new Date(start.getTime() + (hour * 60 * 60 * 1000)).toISOString()
  const queryLog = []
  const events = [
    ...[1, 2, 3].map((hour) => ({ recorded_at: atHour(yesterdayStart, hour) })),
    ...[1, 2, 3, 4, 5].map((hour) => ({ recorded_at: atHour(todayStart, hour) })),
  ]

  const result = await getOverviewWithProductionEvents(events, queryLog)
  const comparison = result.productionAnalytics.day

  assert.deepEqual(Object.keys(result.productionAnalytics), ['day'])
  assert.equal(comparison.label, 'Today vs Yesterday')
  assert.equal(comparison.currentTotal, 5)
  assert.equal(comparison.previousTotal, 3)
  assert.equal(comparison.difference, 2)
  assert.equal(comparison.differencePercent, 66.67)
  assert.equal(comparison.unit, 'pipes')
  assert.equal(Object.hasOwn(comparison, 'targetTotal'), false)
  assert.equal(comparison.points.every((point) => !Object.hasOwn(point, 'target')), true)
  assert.match(result.summary[0].value, /5 pipes/)
  assert.deepEqual(queryLog, [
    { operator: 'gte', tableName: 'sensor_events', column: 'recorded_at', value: yesterdayStart.toISOString() },
    { operator: 'lt', tableName: 'sensor_events', column: 'recorded_at', value: tomorrowStart.toISOString() },
  ])
})

test('overview returns no percentage when yesterday has no production baseline', async () => {
  const todayStart = startOfBusinessDay(new Date())
  const events = [{ recorded_at: new Date(todayStart.getTime() + 3600000).toISOString() }]

  const result = await getOverviewWithProductionEvents(events)

  assert.equal(result.productionAnalytics.day.currentTotal, 1)
  assert.equal(result.productionAnalytics.day.previousTotal, 0)
  assert.equal(result.productionAnalytics.day.difference, 1)
  assert.equal(result.productionAnalytics.day.differencePercent, null)
})
