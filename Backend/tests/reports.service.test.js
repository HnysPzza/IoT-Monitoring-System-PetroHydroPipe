const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

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
  outputSensor = { id: 'sensor-5', machine_id: 'machine-1', sensor_code: 'S-05' },
  outputSensorError = null,
} = {}) {
  const queries = []

  function createQuery(tableName) {
    const queryRecord = { tableName, filters: [], select: null }
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
      async maybeSingle() {
        if (tableName === 'machines') {
          return { data: { id: 'machine-1', name: 'Spiral Mill 01' }, error: null }
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
          result = { data: [], error: null }
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
      machine_id: 'machine-1',
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
      { machine_id: 'machine-1', sensor_id: 'sensor-1', event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z' },
      { machine_id: 'machine-1', sensor_id: 'sensor-2', event_type: 'pulse', recorded_at: '2026-08-09T01:01:00.000Z' },
      { machine_id: 'machine-1', sensor_id: 'sensor-4', event_type: 'pulse', recorded_at: '2026-08-09T01:02:00.000Z' },
      { machine_id: 'machine-1', sensor_id: 'sensor-5', event_type: 'pulse', recorded_at: '2026-08-09T01:03:00.000Z' },
      { machine_id: 'machine-1', sensor_id: 'sensor-5', event_type: 'idle', recorded_at: '2026-08-09T01:04:00.000Z' },
      { machine_id: 'machine-1', sensor_id: 'sensor-5', event_type: 'pulse', recorded_at: '2026-08-09T16:00:00.000Z' },
    ],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09' })

  assert.equal(getProductionSummary(report).value, '1 pcs')

  const sensorQuery = fakeSupabase.queries.find((query) => query.tableName === 'sensors')
  assert.deepEqual(sensorQuery.filters, [
    { operator: 'eq', column: 'machine_id', value: 'machine-1' },
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
