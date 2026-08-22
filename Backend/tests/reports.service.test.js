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

function applyFilters(rows, filters) {
  return rows.filter((row) => filters.every(({ operator, column, value }) => {
    if (operator === 'eq') return row[column] === value
    if (operator === 'gte') return row[column] >= value
    if (operator === 'lt') return row[column] < value
    return true
  }))
}

function createFakeSupabase({
  productionCounts = [],
  sensorEvents = [],
  outputSensor = { id: 'sensor-5', machine_id: MACHINE_ID, sensor_code: 'S-05' },
  outputSensorError = null,
  downtimeEvents = [],
  settingsHistory = DEFAULT_HISTORY,
} = {}) {
  const queries = []

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

        if (tableName === 'sensors') {
          return { data: outputSensorError ? null : outputSensor, error: outputSensorError }
        }

        throw new Error(`Unexpected maybeSingle query for ${tableName}`)
      },
      then(resolve, reject) {
        let result

        if (tableName === 'production_counts') {
          result = { data: applyFilters(productionCounts, queryRecord.filters), error: null }
        } else if (tableName === 'sensor_events') {
          result = { count: applyFilters(sensorEvents, queryRecord.filters).length, error: null }
        } else if (tableName === 'downtime_events') {
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

test('report preserves non-zero production aggregates without querying raw sensor events', async () => {
  const fakeSupabase = createFakeSupabase({
    productionCounts: [{
      machine_id: MACHINE_ID,
      count_value: 12,
      window_start: '2026-08-09T00:00:00.000Z',
    }],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09' })

  assert.equal(getProductionSummary(report).value, '12 pcs')
  assert.equal(fakeSupabase.queries.some((query) => query.tableName === 'sensors'), false)
  assert.equal(fakeSupabase.queries.some((query) => query.tableName === 'sensor_events'), false)
})

test('report fallback counts only S-05 pulse events in the selected business window', async () => {
  const fakeSupabase = createFakeSupabase({
    sensorEvents: [
      { machine_id: MACHINE_ID, sensor_id: 'sensor-1', event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z' },
      { machine_id: MACHINE_ID, sensor_id: 'sensor-2', event_type: 'pulse', recorded_at: '2026-08-09T01:01:00.000Z' },
      { machine_id: MACHINE_ID, sensor_id: 'sensor-4', event_type: 'pulse', recorded_at: '2026-08-09T01:02:00.000Z' },
      { machine_id: MACHINE_ID, sensor_id: 'sensor-5', event_type: 'pulse', recorded_at: '2026-08-09T01:03:00.000Z' },
      { machine_id: MACHINE_ID, sensor_id: 'sensor-5', event_type: 'idle', recorded_at: '2026-08-09T01:04:00.000Z' },
      { machine_id: MACHINE_ID, sensor_id: 'sensor-5', event_type: 'pulse', recorded_at: '2026-08-09T16:00:00.000Z' },
    ],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09' })

  assert.equal(getProductionSummary(report).value, '1 pcs')

  const sensorQuery = fakeSupabase.queries.find((query) => query.tableName === 'sensors')
  assert.deepEqual(sensorQuery.filters, [
    { operator: 'eq', column: 'machine_id', value: MACHINE_ID },
    { operator: 'eq', column: 'sensor_code', value: 'S-05' },
  ])

  const eventQuery = fakeSupabase.queries.find((query) => query.tableName === 'sensor_events')
  assert.equal(eventQuery.filters.some((filter) => filter.column === 'sensor_id' && filter.value === 'sensor-5'), true)
  assert.equal(eventQuery.filters.some((filter) => filter.column === 'event_type' && filter.value === 'pulse'), true)
})

test('report fails closed when S-05 is not configured', async () => {
  const reportsService = loadReportsService(createFakeSupabase({ outputSensor: null }))

  await assert.rejects(
    () => reportsService.getSummary({ type: 'daily', date: '2026-08-09' }),
    (error) => error.status === 500 && error.code === 'REPORT_OUTPUT_SENSOR_NOT_FOUND',
  )
})

test('report returns a controlled error when the S-05 lookup fails', async () => {
  const reportsService = loadReportsService(createFakeSupabase({
    outputSensorError: { message: 'sensor store unavailable' },
  }))

  await assert.rejects(
    () => reportsService.getSummary({ type: 'daily', date: '2026-08-09' }),
    (error) => error.status === 500 && error.code === 'REPORT_OUTPUT_SENSOR_QUERY_FAILED',
  )
})

test('report includes pre-window overlap, unions concurrent downtime, and excludes off-shift loss', async () => {
  const fakeSupabase = createFakeSupabase({
    productionCounts: [{ machine_id: MACHINE_ID, count_value: 1, window_start: '2026-08-09T00:00:00.000Z' }],
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
