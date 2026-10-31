const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const LOSS_BASIS = {
  source: 'configured-fallback',
  ratePiecesPerMinute: 0.05,
  windowStartAt: '2026-07-10T16:00:00.000Z',
  windowEndAt: '2026-08-09T16:00:00.000Z',
  qualifiedProductionDays: 0,
  productiveMinutes: 0,
  outputPieces: 0,
}
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
  sensorEvents = [],
  productionSpecs = [],
  eventsError = null,
  sensorError = null,
  sensorConfig = {
    id: 'sensor-s05-id',
    sensor_code: 'S-05',
    label: 'Pipe Cutting Counter',
    machine_id: MACHINE_ID,
    machines: { id: MACHINE_ID, machine_code: 'M-01', name: 'Spiral Mill 01' },
  },
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
      in(column, values) {
        queryRecord.filters.push({ operator: 'in', column, values })
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
          return { data: sensorConfig, error: sensorError }
        }

        throw new Error(`Unexpected maybeSingle query for ${tableName}`)
      },
      then(resolve, reject) {
        let result

        if (tableName === 'downtime_events') {
          result = { data: downtimeEvents.slice(queryRecord.from, queryRecord.to + 1), error: null }
        } else if (tableName === 'machine_operational_settings_history') {
          result = { data: settingsHistory.slice(queryRecord.from, queryRecord.to + 1), error: null }
        } else if (tableName === 'sensor_events') {
          if (eventsError) {
            result = { data: null, error: eventsError }
          } else {
            result = { data: sensorEvents.slice(queryRecord.from, queryRecord.to + 1), error: null }
          }
        } else if (tableName === 'production_item_specs') {
          const inFilter = queryRecord.filters.find((filter) => filter.operator === 'in')
          const filtered = inFilter && inFilter.values
            ? productionSpecs.filter((spec) => inFilter.values.includes(spec.sensor_event_id))
            : productionSpecs
          result = { data: filtered.slice(queryRecord.from, queryRecord.to + 1), error: null }
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
      const rows = typeof aggregateRows === 'function' ? aggregateRows(rpcCalls.length, args) : aggregateRows
      return Promise.resolve({ data: rows, error: aggregateError })
    },
    from: createQuery,
  }
}

function loadReportsService(fakeSupabase) {
  clearSourceCache()
  mockModule('src/database/client.js', {
    getSupabaseClient: () => fakeSupabase,
  })
  mockModule('src/shared/outputLossBasis.js', {
    getOutputLossBasis: async () => LOSS_BASIS,
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
    outputPieces: 1,
    durationMinutes: 540,
    unplannedMinutes: 60,
    plannedExcludedMinutes: 480,
    scheduledEligibleMinutes: 540,
    availabilityPercent: 89,
    estimatedLoss: 3,
  })
  assert.deepEqual(report.lossEstimateBasis, LOSS_BASIS)
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
  assert.equal(report.generatedAt, '2026-08-31T04:00:00.000Z')
  assert.equal(report.observedEndAt, '2026-08-31T04:00:00.000Z')
  assert.equal(report.metrics.scheduledEligibleMinutes, 240)
  assert.equal(report.metrics.availabilityPercent, 75)
  assert.equal(fakeSupabase.rpcCalls[0].args.p_ended_at, report.observedEndAt)
})

test('current report uses the minimum valid aggregation bucket during its first hour', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T00:30:00+08:00') })
  const fakeSupabase = createFakeSupabase()
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-31' })

  assert.equal(report.periodState, 'partial')
  assert.equal(fakeSupabase.rpcCalls[0].args.p_started_at, '2026-08-30T16:00:00.000Z')
  assert.equal(fakeSupabase.rpcCalls[0].args.p_ended_at, '2026-08-30T16:30:00.000Z')
  assert.equal(fakeSupabase.rpcCalls[0].args.p_bucket_seconds, 3600)
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

test('report includes server-owned prior-period comparison metrics when requested', async () => {
  const fakeSupabase = createFakeSupabase({
    aggregateRows: (callNumber) => [{ sensor_code: 'S-05', event_count: callNumber === 1 ? 12 : 8 }],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09', compare: true })

  assert.equal(report.metrics.outputPieces, 12)
  assert.deepEqual(report.comparison.metrics, {
    outputPieces: 8,
    availabilityPercent: 100,
    estimatedLoss: 0,
  })
  assert.equal(report.comparison.periodState, 'complete')
  assert.equal(fakeSupabase.rpcCalls.length, 2)
})

test('partial comparisons use the same elapsed window from the preceding period', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T12:00:00+08:00') })
  const fakeSupabase = createFakeSupabase()
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-31', compare: true })

  assert.equal(report.periodState, 'partial')
  assert.equal(report.comparison.periodState, 'partial')
  assert.equal(report.comparison.observedEndAt, '2026-08-30T04:00:00.000Z')
  assert.equal(fakeSupabase.rpcCalls[1].args.p_started_at, '2026-08-29T16:00:00.000Z')
  assert.equal(fakeSupabase.rpcCalls[1].args.p_ended_at, '2026-08-30T04:00:00.000Z')
})

test('production report computes KPIs, grouped specs, and chronological logs', async () => {
  const sensorEvents = [
    {
      id: 'event-1',
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: 'DEV-101',
      event_type: 'pulse',
      recorded_at: '2026-08-09T01:00:00.000Z',
      output_accepted: true,
    },
    {
      id: 'event-2',
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: 'DEV-102',
      event_type: 'pulse',
      recorded_at: '2026-08-09T02:00:00.000Z',
      output_accepted: true,
    },
    {
      id: 'event-3',
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: 'DEV-103',
      event_type: 'pulse',
      recorded_at: '2026-08-09T03:00:00.000Z',
      output_accepted: true,
    },
  ]
  const productionSpecs = [
    {
      sensor_event_id: 'event-1',
      label: 'Pipe A',
      size: '2 inch',
      diameter: 2,
      radius: 1,
      circumference: 6.28,
      updated_at: '2026-08-09T01:10:00.000Z',
      updated_by: 'user-1',
    },
    {
      sensor_event_id: 'event-2',
      label: 'Pipe A',
      size: '2 inch',
      diameter: 2,
      radius: 1,
      circumference: 6.28,
      updated_at: '2026-08-09T02:10:00.000Z',
      updated_by: 'user-1',
    },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.category, 'production')
  assert.equal(report.reportType, 'daily')
  assert.equal(report.selectedDate, '2026-08-09')
  assert.equal(report.periodState, 'complete')

  assert.equal(report.totalProductionOutput, 3)
  assert.equal(report.specifiedPipes, 2)
  assert.equal(report.unspecifiedPipes, 1)
  assert.equal(report.distinctProductSizes, 1)

  assert.deepEqual(report.metrics, {
    totalProductionOutput: 3,
    specifiedPipes: 2,
    unspecifiedPipes: 1,
    distinctProductSizes: 1,
  })

  assert.equal(report.specBreakdown.length, 2)
  const specifiedGroup = report.specBreakdown[0]
  assert.equal(specifiedGroup.label, 'Pipe A')
  assert.equal(specifiedGroup.size, '2 inch')
  assert.equal(specifiedGroup.diameter, 2)
  assert.equal(specifiedGroup.radius, 1)
  assert.equal(specifiedGroup.circumference, 6.28)
  assert.equal(specifiedGroup.pipeCount, 2)
  assert.equal(specifiedGroup.percentageOfTotal, 66.7)
  assert.equal(specifiedGroup.firstCutAt, '2026-08-09T01:00:00.000Z')
  assert.equal(specifiedGroup.lastCutAt, '2026-08-09T02:00:00.000Z')
  assert.equal(specifiedGroup.isSpecified, true)

  const unspecifiedGroup = report.specBreakdown[1]
  assert.equal(unspecifiedGroup.label, 'Unspecified / Pending Tag')
  assert.equal(unspecifiedGroup.size, null)
  assert.equal(unspecifiedGroup.pipeCount, 1)
  assert.equal(unspecifiedGroup.percentageOfTotal, 33.3)
  assert.equal(unspecifiedGroup.firstCutAt, '2026-08-09T03:00:00.000Z')
  assert.equal(unspecifiedGroup.lastCutAt, '2026-08-09T03:00:00.000Z')
  assert.equal(unspecifiedGroup.isSpecified, false)

  assert.equal(report.productionLogs.length, 3)
  assert.equal(report.productionLogs[0].deviceEventId, 'DEV-101')
  assert.equal(report.productionLogs[0].isSpecified, true)
  assert.equal(report.productionLogs[2].deviceEventId, 'DEV-103')
  assert.equal(report.productionLogs[2].isSpecified, false)
})

test('production report groups distinct product sizes correctly', async () => {
  const sensorEvents = [
    { id: 'e-1', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z', output_accepted: true },
    { id: 'e-2', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T02:00:00.000Z', output_accepted: true },
    { id: 'e-3', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T03:00:00.000Z', output_accepted: true },
  ]
  const productionSpecs = [
    { sensor_event_id: 'e-1', label: 'Water Pipe', size: '2 inch' },
    { sensor_event_id: 'e-2', label: 'Drain Pipe', size: '4 inch' },
    { sensor_event_id: 'e-3', label: 'Drain Pipe', size: '6 inch' },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.distinctProductSizes, 3)
  assert.equal(report.specifiedPipes, 3)
  assert.equal(report.unspecifiedPipes, 0)
  assert.equal(report.specBreakdown.length, 3)
})

test('future production report returns unobserved values without querying events', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T12:00:00+08:00') })
  const fakeSupabase = createFakeSupabase()
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-09-01' })

  assert.equal(report.periodState, 'future')
  assert.equal(report.observedStartAt, null)
  assert.equal(report.observedEndAt, null)
  assert.equal(report.metrics.totalProductionOutput, null)
  assert.equal(report.metrics.specifiedPipes, null)
  assert.equal(report.metrics.unspecifiedPipes, null)
  assert.equal(report.metrics.distinctProductSizes, null)
  assert.deepEqual(report.specBreakdown, [])
  assert.deepEqual(report.productionLogs, [])
  assert.equal(fakeSupabase.queries.some((q) => q.tableName === 'sensor_events'), false)
  assert.equal(fakeSupabase.queries.some((q) => q.tableName === 'production_item_specs'), false)
})

test('partial production report clips end timestamp to elapsed time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T12:00:00+08:00') })
  const fakeSupabase = createFakeSupabase()
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-31' })

  assert.equal(report.periodState, 'partial')
  assert.equal(report.observedEndAt, '2026-08-31T04:00:00.000Z')
})

test('production report supports prior period comparison', async () => {
  let callCount = 0
  const fakeSupabase = createFakeSupabase()
  fakeSupabase.from = (tableName) => {
    const query = createFakeSupabase().from(tableName)
    if (tableName === 'sensor_events') {
      callCount += 1
      const count = callCount === 1 ? 5 : 3
      const events = Array.from({ length: count }, (_, i) => ({
        id: `ev-${callCount}-${i}`,
        sensor_id: 'sensor-s05-id',
        machine_id: MACHINE_ID,
        event_type: 'pulse',
        recorded_at: '2026-08-09T01:00:00.000Z',
        output_accepted: true,
      }))
      query.then = (resolve) => resolve({ data: events, error: null })
    }
    return query
  }

  const reportsService = loadReportsService(fakeSupabase)
  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09', compare: true })

  assert.equal(report.totalProductionOutput, 5)
  assert.equal(report.comparison.metrics.totalProductionOutput, 3)
})

test('backward compatibility: omitting category defaults to regular operational report', async () => {
  const fakeSupabase = createFakeSupabase({
    aggregateRows: [{ sensor_code: 'S-05', event_count: 7 }],
  })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ type: 'daily', date: '2026-08-09' })

  assert.equal(report.category, 'regular')
  assert.equal(report.metrics.outputPieces, 7)
  assert.ok(report.processSensors)
})

test('production report handles empty period with zero production output cleanly', async () => {
  const fakeSupabase = createFakeSupabase({ sensorEvents: [], productionSpecs: [] })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.totalProductionOutput, 0)
  assert.equal(report.specifiedPipes, 0)
  assert.equal(report.unspecifiedPipes, 0)
  assert.equal(report.distinctProductSizes, 0)
  assert.deepEqual(report.specBreakdown, [])
  assert.deepEqual(report.productionLogs, [])
})

test('production report differentiates geometry-only pipe specifications without labels', async () => {
  const sensorEvents = [
    { id: 'ev-geom-1', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z', output_accepted: true },
    { id: 'ev-geom-2', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T02:00:00.000Z', output_accepted: true },
    { id: 'ev-geom-3', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T03:00:00.000Z', output_accepted: true },
  ]
  const productionSpecs = [
    { sensor_event_id: 'ev-geom-1', label: null, size: null, diameter: 50.0 },
    { sensor_event_id: 'ev-geom-2', label: null, size: null, diameter: 100.0 },
    { sensor_event_id: 'ev-geom-3', label: null, size: null, diameter: 50.0 },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.totalProductionOutput, 3)
  assert.equal(report.specifiedPipes, 3)
  assert.equal(report.unspecifiedPipes, 0)
  assert.equal(report.distinctProductSizes, 2)
  assert.equal(report.specBreakdown.length, 2)
  assert.equal(report.specBreakdown[0].pipeCount, 2)
  assert.equal(report.specBreakdown[0].diameter, 50.0)
  assert.equal(report.specBreakdown[1].pipeCount, 1)
  assert.equal(report.specBreakdown[1].diameter, 100.0)
})

test('production report sorts events with identical timestamps deterministically by id', async () => {
  const sensorEvents = [
    { id: 'ev-z-id', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z', output_accepted: true },
    { id: 'ev-a-id', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z', output_accepted: true },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.productionLogs[0].id, 'ev-a-id')
  assert.equal(report.productionLogs[1].id, 'ev-z-id')
})

test('production report throws controlled error when production sensor is not configured', async () => {
  const fakeSupabase = createFakeSupabase({ sensorConfig: null })
  const reportsService = loadReportsService(fakeSupabase)

  await assert.rejects(
    async () => reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' }),
    (err) => err.code === 'REPORT_PRODUCTION_SENSOR_MISSING' && err.status === 500,
  )
})

test('production report throws controlled error when repository query fails', async () => {
  const fakeSupabase = createFakeSupabase({
    eventsError: new Error('Postgres connection failed.'),
  })
  const reportsService = loadReportsService(fakeSupabase)

  await assert.rejects(
    async () => reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' }),
    (err) => err.code === 'REPORT_PRODUCTION_EVENTS_QUERY_FAILED' && err.status === 500,
  )
})

test('production report parses positive dimensions strictly, treating empty strings, whitespace, 0, and negatives as null', async () => {
  const sensorEvents = [
    { id: 'ev-1', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z', output_accepted: true },
    { id: 'ev-2', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T02:00:00.000Z', output_accepted: true },
  ]
  const productionSpecs = [
    { sensor_event_id: 'ev-1', label: '', size: '   ', diameter: '0', radius: '   ', circumference: '' },
    { sensor_event_id: 'ev-2', label: 'Tag 2', size: '4 inch', diameter: '50.5', radius: '-5', circumference: 'Infinity' },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.specifiedPipes, 1)
  assert.equal(report.unspecifiedPipes, 1)
  const log1 = report.productionLogs.find((l) => l.id === 'ev-1')
  assert.equal(log1.diameter, null)
  assert.equal(log1.radius, null)
  assert.equal(log1.circumference, null)
  assert.equal(log1.isSpecified, false)

  const log2 = report.productionLogs.find((l) => l.id === 'ev-2')
  assert.equal(log2.diameter, 50.5)
  assert.equal(log2.radius, null)
  assert.equal(log2.circumference, null)
  assert.equal(log2.isSpecified, true)
})

test('production report groups identical pipe sizes with different heat/batch labels under the same distinct size', async () => {
  const sensorEvents = [
    { id: 'ev-1', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z', output_accepted: true },
    { id: 'ev-2', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T02:00:00.000Z', output_accepted: true },
    { id: 'ev-3', sensor_id: 'sensor-s05-id', machine_id: MACHINE_ID, event_type: 'pulse', recorded_at: '2026-08-09T03:00:00.000Z', output_accepted: true },
  ]
  const productionSpecs = [
    { sensor_event_id: 'ev-1', label: 'Heat Batch 001', size: '6 inch' },
    { sensor_event_id: 'ev-2', label: 'Heat Batch 002', size: '6 inch' },
    { sensor_event_id: 'ev-3', label: 'Heat Batch 003', size: '8 inch' },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.totalProductionOutput, 3)
  assert.equal(report.specifiedPipes, 3)
  assert.equal(report.distinctProductSizes, 2)
})

test('production report summary caps productionLogs at 200 cuts while export returns complete logs', async () => {
  const sensorEvents = []
  const productionSpecs = []
  for (let i = 0; i < 250; i++) {
    const id = `ev-${String(i).padStart(3, '0')}`
    sensorEvents.push({
      id,
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: i,
      event_type: 'pulse',
      recorded_at: new Date(Date.parse('2026-08-09T00:00:00.000Z') + i * 60000).toISOString(),
      output_accepted: true,
    })
    productionSpecs.push({
      sensor_event_id: id,
      label: `Pipe ${i}`,
      size: '6 inch',
    })
  }

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const summaryReport = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })
  assert.equal(summaryReport.totalProductionOutput, 250)
  assert.equal(summaryReport.productionLogs.length, 200)
  assert.equal(summaryReport.productionLogs[0].deviceEventId, 50)
  assert.equal(summaryReport.productionLogs[199].deviceEventId, 249)

  const exportReport = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' }, { maxLogs: null })
  assert.equal(exportReport.totalProductionOutput, 250)
  assert.equal(exportReport.productionLogs.length, 250)
  assert.equal(exportReport.productionLogs[0].deviceEventId, 0)
})

test('future production report provides complete machine and sensor stubs', async () => {
  const fakeSupabase = createFakeSupabase()
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({
    category: 'production',
    type: 'daily',
    date: '2026-12-31',
  }, { asOf: new Date('2026-08-09T00:00:00.000Z') })

  assert.equal(report.periodState, 'future')
  assert.ok(report.machine)
  assert.equal(report.machine.code, 'M-01')
  assert.equal(report.machine.name, 'Spiral Mill 01')
  assert.ok(report.sensor)
  assert.equal(report.sensor.code, 'S-05')
  assert.ok(report.sensor.label)
})

test('repository error preserves original database error cause', async () => {
  const dbError = new Error('Connection terminated unexpectedly.')
  dbError.code = '57P01'

  const fakeSupabase = createFakeSupabase({
    eventsError: dbError,
  })
  const reportsService = loadReportsService(fakeSupabase)

  try {
    await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })
    assert.fail('Expected query to fail')
  } catch (err) {
    assert.equal(err.code, 'REPORT_PRODUCTION_EVENTS_QUERY_FAILED')
    assert.equal(err.cause, dbError)
    assert.equal(err.cause.code, '57P01')
  }
})

test('comparison period query optimizes payload with metricsOnly', async () => {
  let callCount = 0
  const fakeSupabase = createFakeSupabase()
  fakeSupabase.from = (tableName) => {
    const query = createFakeSupabase().from(tableName)
    if (tableName === 'sensor_events') {
      callCount += 1
      const count = callCount === 1 ? 5 : 3
      const events = Array.from({ length: count }, (_, i) => ({
        id: `ev-${callCount}-${i}`,
        sensor_id: 'sensor-s05-id',
        machine_id: MACHINE_ID,
        event_type: 'pulse',
        recorded_at: '2026-08-09T01:00:00.000Z',
        output_accepted: true,
      }))
      query.then = (resolve) => resolve({ data: events, error: null })
    }
    return query
  }

  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({
    category: 'production',
    type: 'daily',
    date: '2026-08-09',
    compare: true,
  }, { asOf: new Date('2026-08-10T00:00:00.000Z') })

  assert.ok(report.comparison)
  assert.equal(report.totalProductionOutput, 5)
  assert.equal(report.comparison.metrics.totalProductionOutput, 3)
})

test('sensorIdentity derives PROCESS_SENSOR_CODES excluding S-03 and S-05', () => {
  const { PROCESS_SENSOR_CODES, OUTPUT_SENSOR_CODE } = require('../src/shared/sensorIdentity')
  assert.deepEqual(PROCESS_SENSOR_CODES, ['S-01', 'S-02', 'S-04'])
  assert.equal(OUTPUT_SENSOR_CODE, 'S-05')
  assert.ok(!PROCESS_SENSOR_CODES.includes('S-03'))
  assert.ok(!PROCESS_SENSOR_CODES.includes('S-05'))
})

test('findAcceptedCuttingEvents throws REPORT_PRODUCTION_EVENT_LIMIT_EXCEEDED when exceeding MAX_PAGES', async () => {
  const reportsRepo = require('../src/modules/reports/reports.repository')
  const fakeClient = {
    from() {
      return {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lt() { return this },
        order() { return this },
        range() {
          return Promise.resolve({
            data: Array.from({ length: 500 }, (_, i) => ({ id: `ev-${i}`, recorded_at: '2026-08-09T01:00:00.000Z' })),
            error: null,
          })
        },
      }
    },
  }

  await assert.rejects(
    async () => reportsRepo.findAcceptedCuttingEvents({
      sensorId: 'sensor-1',
      startIso: '2026-08-09T00:00:00.000Z',
      endIso: '2026-08-10T00:00:00.000Z',
    }, fakeClient),
    (err) => err.code === 'REPORT_PRODUCTION_EVENT_LIMIT_EXCEEDED' && err.status === 500,
  )
})

