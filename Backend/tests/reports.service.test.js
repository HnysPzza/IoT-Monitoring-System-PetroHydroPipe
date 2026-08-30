const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const DEFAULT_HISTORY = [{
  machine_id: MACHINE_ID,
  version: '1',
  shift_schedule: {
    workStart: '08:00',
    workEnd: '17:00',
    breaks: [],
    rampUpGraceMinutes: 0,
  },
  effective_from: null,
  effective_to: null,
}]

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

function createFakeSupabase({
  aggregateRows = [],
  aggregateError = null,
  downtimeEvents = [],
  settingsHistory = DEFAULT_HISTORY,
} = {}) {
  const queries = []
  const rpcCalls = []

  function createQuery(tableName) {
    const queryRecord = { tableName, filters: [], select: null, from: 0, to: Number.POSITIVE_INFINITY }
    queries.push(queryRecord)

    const query = {
      select(columns, options) {
        queryRecord.select = { columns, options }
        return this
      },
      eq(column, value) {
        queryRecord.filters.push({ operator: 'eq', column, value })
        return this
      },
      gte(column, value) {
        queryRecord.filters.push({ operator: 'gte', column, value })
        return this
      },
      lt(column, value) {
        queryRecord.filters.push({ operator: 'lt', column, value })
        return this
      },
      or(expression) {
        queryRecord.filters.push({ operator: 'or', expression })
        return this
      },
      order() { return this },
      range(from, to) {
        queryRecord.from = from
        queryRecord.to = to
        return this
      },
      async maybeSingle() {
        if (tableName === 'machines') {
          return { data: { id: MACHINE_ID, name: 'Spiral Mill 01' }, error: null }
        }

        throw new Error(`Unexpected maybeSingle query for ${tableName}`)
      },
      then(resolve, reject) {
        let result

        if (tableName === 'downtime_events') {
          result = { data: downtimeEvents.slice(queryRecord.from, queryRecord.to + 1), error: null }
        } else if (tableName === 'machine_operational_settings_history') {
          result = { data: settingsHistory.slice(queryRecord.from, queryRecord.to + 1), error: null }
        } else {
          result = { data: [], error: null }
        }

        return Promise.resolve(result).then(resolve, reject)
      },
    }

    return query
  }

  return {
    queries,
    rpcCalls,
    rpc(functionName, args) {
      rpcCalls.push({ functionName, args })
      return Promise.resolve({ data: aggregateRows, error: aggregateError })
    },
    from: createQuery,
  }
}

function loadReportsService(fakeSupabase) {
  clearSourceCache()
  mockModule('src/database/client.js', {
    getSupabaseClient: () => fakeSupabase,
  })
  return require(path.join(backendRoot, 'src', 'modules', 'reports', 'reports.service.js'))
}

function getProductionSummary(report) {
  return report.summary.find((item) => item.id === 'production')
}

test('report derives production from the shared S-05 event aggregation', async () => {
  const fakeSupabase = createFakeSupabase({
    aggregateRows: [{ sensor_code: 'S-05', event_count: 12 }],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09' })

  assert.equal(getProductionSummary(report).value, '12 pcs')
  assert.equal(fakeSupabase.queries.some((query) => query.tableName === 'production_counts'), false)
  assert.equal(fakeSupabase.queries.some((query) => query.tableName === 'sensor_events'), false)
  assert.deepEqual(fakeSupabase.rpcCalls, [{
    functionName: 'aggregate_analytics_sensor_events',
    args: {
      p_machine_id: MACHINE_ID,
      p_started_at: '2026-08-08T16:00:00.000Z',
      p_ended_at: '2026-08-09T16:00:00.000Z',
      p_bucket_seconds: 86400,
    },
  }])
})

test('report ignores process-sensor rows in the shared aggregation', async () => {
  const fakeSupabase = createFakeSupabase({
    aggregateRows: [
      { sensor_code: 'S-01', event_count: 10 },
      { sensor_code: 'S-02', event_count: 20 },
      { sensor_code: 'S-04', event_count: 30 },
      { sensor_code: 'S-05', event_count: 2 },
    ],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09' })

  assert.equal(getProductionSummary(report).value, '2 pcs')
  assert.equal(report.summary.find((item) => item.id === 'process-events').value, '60')
  assert.deepEqual(report.processSensors, [
    { sensorCode: 'S-01', sensorLabel: 'Raw Material & Coil Joint', eventCount: 10 },
    { sensorCode: 'S-02', sensorLabel: 'Inside Filler Wire', eventCount: 20 },
    { sensorCode: 'S-04', sensorLabel: 'Outside Filler Wire', eventCount: 30 },
  ])
})

test('report returns a controlled error when shared event aggregation fails', async () => {
  const reportsService = loadReportsService(createFakeSupabase({
    aggregateError: { message: 'event store unavailable' },
  }))

  await assert.rejects(
    () => reportsService.getSummary({ type: 'daily', date: '2026-08-09' }),
    (error) => error.status === 500 && error.code === 'SENSOR_EVENT_AGGREGATION_FAILED',
  )
})

test('report includes pre-window overlap, unions concurrent downtime, and excludes off-shift loss', async () => {
  const fakeSupabase = createFakeSupabase({
    aggregateRows: [{ sensor_code: 'S-05', event_count: 1 }],
    downtimeEvents: [
      {
        id: 'down-1',
        machine_id: MACHINE_ID,
        sensor_id: 'sensor-1',
        started_at: '2026-08-08T15:30:00.000Z',
        ended_at: '2026-08-09T00:30:00.000Z',
        cause: 'Flux Refill',
        status: 'Resolved',
        sensors: { sensor_code: 'S-01' },
      },
      {
        id: 'down-2',
        machine_id: MACHINE_ID,
        sensor_id: 'sensor-2',
        started_at: '2026-08-09T00:00:00.000Z',
        ended_at: '2026-08-09T01:00:00.000Z',
        cause: 'ID Filler Refill',
        status: 'Resolved',
        sensors: { sensor_code: 'S-02' },
      },
    ],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09' })

  assert.deepEqual(report.metrics, {
    durationMinutes: 540,
    unplannedMinutes: 60,
    plannedExcludedMinutes: 480,
    scheduledEligibleMinutes: 540,
    availabilityPercent: 89,
    estimatedLoss: 138,
  })
  assert.equal(report.rows.some((row) => row.cause === 'Concurrent causes'), true)
  const overlapQuery = fakeSupabase.queries.find((query) => query.tableName === 'downtime_events')
  assert.equal(overlapQuery.filters.some((filter) => filter.operator === 'gte' && filter.column === 'started_at'), false)
  assert.equal(overlapQuery.filters.some((filter) => filter.operator === 'or' && /ended_at\.gt\./.test(filter.expression)), true)
})

test('current report clips events and availability to elapsed eligible time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T12:00:00+08:00') })
  const fakeSupabase = createFakeSupabase({
    downtimeEvents: [{
      id: 'down-current',
      machine_id: MACHINE_ID,
      sensor_id: 'sensor-1',
      started_at: '2026-08-31T00:00:00.000Z',
      ended_at: '2026-08-31T01:00:00.000Z',
      cause: 'Flux Refill',
      status: 'Resolved',
      sensors: { sensor_code: 'S-01' },
    }],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-31' })

  assert.equal(report.periodState, 'partial')
  assert.equal(report.observedEndAt, '2026-08-31T04:00:00.000Z')
  assert.equal(report.metrics.scheduledEligibleMinutes, 240)
  assert.equal(report.metrics.availabilityPercent, 75)
  assert.equal(fakeSupabase.rpcCalls[0].args.p_ended_at, report.observedEndAt)
})

test('future report returns unobserved values without querying operational records', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T12:00:00+08:00') })
  const fakeSupabase = createFakeSupabase()
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-09-01' })

  assert.equal(report.periodState, 'future')
  assert.equal(report.observedStartAt, null)
  assert.equal(report.observedEndAt, null)
  assert.equal(report.summary.every((item) => item.value === 'N/A'), true)
  assert.equal(report.processSensors.every((sensor) => sensor.eventCount === null), true)
  assert.equal(report.metrics.availabilityPercent, null)
  assert.equal(fakeSupabase.rpcCalls.length, 0)
  assert.equal(fakeSupabase.queries.some((query) => query.tableName === 'downtime_events'), false)
})
