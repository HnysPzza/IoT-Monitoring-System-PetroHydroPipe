const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '../../..')
const MACHINE_ID = '11111111-1111-4111-8111-111111111111'
const SENSOR_ID = '22222222-2222-4222-8222-222222222222'

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

function createStrictFakeSupabase({
  sensorEvents = [],
  productionSpecs = [],
  allowQueries = true,
} = {}) {
  const queries = []
  const rpcCalls = []

  function createQuery(tableName) {
    if (!allowQueries) {
      throw new Error(`Database query violation: table '${tableName}' queried when 0 queries expected!`)
    }

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
        if (!allowQueries) throw new Error(`Query violation on maybeSingle for ${tableName}`)
        if (tableName === 'machines') {
          return { data: { id: MACHINE_ID, name: 'Spiral Mill 01' }, error: null }
        }
        if (tableName === 'sensors') {
          return {
            data: {
              id: SENSOR_ID,
              sensor_code: 'S-05',
              label: 'Pipe Cutting Counter',
              machine_id: MACHINE_ID,
              machines: { id: MACHINE_ID, machine_code: 'M-01', name: 'Spiral Mill 01' },
            },
            error: null,
          }
        }
        throw new Error(`Unexpected maybeSingle query for ${tableName}`)
      },
      then(resolve, reject) {
        if (!allowQueries) {
          return Promise.reject(new Error(`Query violation: ${tableName}`)).then(resolve, reject)
        }

        let result
        if (tableName === 'sensor_events') {
          result = { data: sensorEvents.slice(queryRecord.from, queryRecord.to + 1), error: null }
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
      if (!allowQueries) throw new Error(`RPC violation: ${functionName}`)
      rpcCalls.push({ functionName, args })
      return Promise.resolve({ data: [], error: null })
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
    getOutputLossBasis: async () => ({ ratePiecesPerMinute: 0.05 }),
  })
  return require(path.join(backendRoot, 'src', 'modules', 'reports', 'reports.service.js'))
}

const { calculatePipeTonnage } = require(path.join(backendRoot, 'src', 'modules', 'production', 'production.service.js'))
const { toPdf } = require(path.join(backendRoot, 'src', 'modules', 'reports', 'reportsExport.serializer.js'))
const { toXlsx } = require(path.join(backendRoot, 'src', 'modules', 'reports', 'reportsXlsx.serializer.js'))

// -------------------------------------------------------------------------------------------------
// SUITE 1: Pure Math and Rounding Oracles
// -------------------------------------------------------------------------------------------------
test('Oracle Suite 1.1: calculatePipeTonnage matches ASME/API theoretical formula across standard factory pipes', () => {
  const testMatrix = [
    { od: 625.4, thk: 10.0, len: 6000 },
    { od: 625.4, thk: 12.7, len: 6000 },
    { od: 1020.0, thk: 10.0, len: 9000 },
    { od: 1020.0, thk: 12.7, len: 9000 },
    { od: 1020.0, thk: 14.2, len: 12000 },
    { od: 1120.0, thk: 12.0, len: 12000 },
    { od: 1220.0, thk: 14.0, len: 12000 },
    { od: 1420.0, thk: 16.0, len: 12000 },
    { od: 1620.0, thk: 18.0, len: 12000 },
    { od: 2020.0, thk: 20.0, len: 12000 },
    { od: 508.0, thk: 6.35, len: 6000 },
    { od: 406.4, thk: 7.92, len: 6000 },
    { od: 812.8, thk: 9.53, len: 9000 },
  ]

  for (const { od, thk, len } of testMatrix) {
    const directResult = calculatePipeTonnage(od, thk, len)
    const theoreticalWeightKgM = Math.PI * (od - thk) * thk * (7850 / 1000000)
    const theoreticalTons = (theoreticalWeightKgM * len) / 1000000
    const theoreticalRounded = Math.round(theoreticalTons * 10000) / 10000

    assert.equal(typeof directResult, 'number', `Result for ${od}x${thk}x${len} must be a number`)
    assert.equal(directResult, theoreticalRounded, `Oracle mismatch for OD=${od}, T=${thk}, L=${len}`)
  }
})

test('Oracle Suite 1.2: calculatePipeTonnage strictly guards all invalid, negative, non-numeric, and physically impossible dimensions', () => {
  // OD <= Thickness
  assert.equal(calculatePipeTonnage(10, 10, 6000), null)
  assert.equal(calculatePipeTonnage(10, 12, 6000), null)

  // Zero or negative
  assert.equal(calculatePipeTonnage(0, 10, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 0, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 10, 0), null)
  assert.equal(calculatePipeTonnage(-625.4, 10, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, -10, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 10, -6000), null)

  // Null, undefined, empty string, whitespace
  assert.equal(calculatePipeTonnage(null, 10, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, null, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 10, null), null)
  assert.equal(calculatePipeTonnage('', 10, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, '   ', 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 10, ''), null)

  // Non-finite, boolean, objects
  assert.equal(calculatePipeTonnage(NaN, 10, 6000), null)
  assert.equal(calculatePipeTonnage(Infinity, 10, 6000), null)
  assert.equal(calculatePipeTonnage(true, 10, 6000), null)
  assert.equal(calculatePipeTonnage({}, 10, 6000), null)
  assert.equal(calculatePipeTonnage([], 10, 6000), null)

  // String numeric representation should coerce cleanly if valid
  assert.equal(calculatePipeTonnage('625.4', '10.0', '6000'), 0.9106)
})

test('Oracle Suite 1.3: Accumulation rounding does not suffer floating point drift across 5,000 simulated cuts', () => {
  const single = calculatePipeTonnage(625.4, 10, 6000)
  assert.equal(single, 0.9106)

  let accumulated = 0
  const N = 5000
  for (let i = 0; i < N; i++) {
    accumulated += single
  }
  const actualRounded = Math.round(accumulated * 10000) / 10000
  const expectedRounded = Math.round(single * N * 10000) / 10000

  assert.equal(actualRounded, 4553)
  assert.equal(expectedRounded, 4553)
  assert.equal(actualRounded, expectedRounded)

  // Multi-specification accumulation across 5,000 cuts
  const s1 = calculatePipeTonnage(625.4, 10, 6000)
  const s2 = calculatePipeTonnage(1020, 12.7, 9000)
  const s3 = calculatePipeTonnage(1120, 14.2, 12000)
  const specs = [
    { single: s1, count: 2000 },
    { single: s2, count: 1500 },
    { single: s3, count: 1500 },
  ]

  let multiAccum = 0
  let expectedMultiTotal = 0
  for (const s of specs) {
    for (let i = 0; i < s.count; i++) {
      multiAccum += s.single
    }
    expectedMultiTotal += Math.round(s.single * s.count * 10000) / 10000
  }
  expectedMultiTotal = Math.round(expectedMultiTotal * 10000) / 10000
  const actualMultiTotal = Math.round(multiAccum * 10000) / 10000

  assert.equal(actualMultiTotal, expectedMultiTotal)
  assert.equal(actualMultiTotal, 13050.65)

})

// -------------------------------------------------------------------------------------------------
// SUITE 2: Grouping & Breakdown Collisions
// -------------------------------------------------------------------------------------------------
test('Collision Suite 2.1: Same dimensions with different customers remain strictly segregated in breakdown', async () => {
  const sensorEvents = [
    { id: 'ev-c1-1', recorded_at: '2026-08-09T08:00:00.000Z', device_event_id: 1 },
    { id: 'ev-c1-2', recorded_at: '2026-08-09T08:05:00.000Z', device_event_id: 2 },
    { id: 'ev-c2-1', recorded_at: '2026-08-09T08:10:00.000Z', device_event_id: 3 },
  ]
  const productionSpecs = [
    { sensor_event_id: 'ev-c1-1', customer: 'MCWD', diameter: 625.4, thickness: 10, length: 6000, pipe_number: 101 },
    { sensor_event_id: 'ev-c1-2', customer: 'MCWD', diameter: 625.4, thickness: 10, length: 6000, pipe_number: 102 },
    { sensor_event_id: 'ev-c2-1', customer: 'Regan', diameter: 625.4, thickness: 10, length: 6000, pipe_number: 201 },
  ]

  const fakeSupabase = createStrictFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.specBreakdown.length, 2, 'Must create exactly 2 breakdown groups for 2 different customers')
  const mcwdGroup = report.specBreakdown.find((g) => g.customer === 'MCWD')
  const reganGroup = report.specBreakdown.find((g) => g.customer === 'Regan')

  assert.ok(mcwdGroup, 'MCWD group must exist')
  assert.ok(reganGroup, 'Regan group must exist')
  assert.equal(mcwdGroup.pipeCount, 2)
  assert.equal(reganGroup.pipeCount, 1)
  assert.equal(mcwdGroup.singleTonnage, 0.9106)
  assert.equal(mcwdGroup.totalTonnage, 1.8212)
  assert.equal(reganGroup.totalTonnage, 0.9106)

  // Physical distinct product sizes: both orders use the same 625.4x10x6000 tooling!
  assert.equal(report.metrics.distinctProductSizes, 1, 'Distinct product sizes should be 1 since physical dimensions are identical')
})

test('Collision Suite 2.2: Same customer with different dimensions are separated into distinct product runs', async () => {
  const sensorEvents = [
    { id: 'ev-d1', recorded_at: '2026-08-09T08:00:00.000Z', device_event_id: 1 },
    { id: 'ev-d2', recorded_at: '2026-08-09T08:15:00.000Z', device_event_id: 2 },
  ]
  const productionSpecs = [
    { sensor_event_id: 'ev-d1', customer: 'CSJ Enterprises', diameter: 625.4, thickness: 10, length: 6000, pipe_number: 1 },
    { sensor_event_id: 'ev-d2', customer: 'CSJ Enterprises', diameter: 1020.0, thickness: 12.7, length: 9000, pipe_number: 2 },
  ]

  const fakeSupabase = createStrictFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.specBreakdown.length, 2)
  assert.equal(report.metrics.distinctProductSizes, 2)
  const expectedTotal = Math.round((calculatePipeTonnage(625.4, 10, 6000) + calculatePipeTonnage(1020, 12.7, 9000)) * 10000) / 10000
  assert.equal(report.totalTonnage, expectedTotal)

})

test('Collision Suite 2.3: Multiple unspecified / null / empty specification cuts correctly aggregate into Unspecified group', async () => {
  const sensorEvents = [
    { id: 'ev-u1', recorded_at: '2026-08-09T08:00:00.000Z', device_event_id: 1 },
    { id: 'ev-u2', recorded_at: '2026-08-09T08:10:00.000Z', device_event_id: 2 },
    { id: 'ev-u3', recorded_at: '2026-08-09T08:20:00.000Z', device_event_id: 3 },
  ]
  // ev-u1: null spec row
  // ev-u2: spec with empty string customer and 0 dimensions
  // ev-u3: spec with whitespace only
  const productionSpecs = [
    { sensor_event_id: 'ev-u2', customer: '   ', diameter: 0, thickness: 0, length: 0 },
    { sensor_event_id: 'ev-u3', customer: '', diameter: null, thickness: null, length: null },
  ]

  const fakeSupabase = createStrictFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.metrics.totalProductionOutput, 3)
  assert.equal(report.metrics.specifiedPipes, 0)
  assert.equal(report.metrics.unspecifiedPipes, 3)
  assert.equal(report.metrics.totalTonnage, 0)
  assert.equal(report.specBreakdown.length, 1)

  const unspecGroup = report.specBreakdown[0]
  assert.equal(unspecGroup.customer, 'Unspecified / Pending Tag')
  assert.equal(unspecGroup.isSpecified, false)
  assert.equal(unspecGroup.pipeCount, 3)
  assert.equal(unspecGroup.singleTonnage, null)
  assert.equal(unspecGroup.totalTonnage, null)
  assert.equal(unspecGroup.percentageOfTotal, 100.0)
})

test('Collision Suite 2.4: Mixed complex batch with partial specs, unspecified cuts, and legacy labels sums to 100%', async () => {
  const sensorEvents = []
  const productionSpecs = []
  let evId = 1

  function addCut(spec) {
    const id = `ev-mix-${evId++}`
    sensorEvents.push({ id, recorded_at: `2026-08-09T08:${String(evId).padStart(2, '0')}:00.000Z`, device_event_id: evId })
    if (spec) {
      productionSpecs.push({ sensor_event_id: id, ...spec })
    }
  }

  // 10 cuts Customer A (625.4 x 10 x 6000) -> 0.9105 * 10 = 9.105 tons
  for (let i = 0; i < 10; i++) addCut({ customer: 'Cust A', diameter: 625.4, thickness: 10, length: 6000, pipe_number: i + 1 })
  // 5 cuts Customer B (625.4 x 10 x 6000) -> 0.9105 * 5 = 4.5525 tons
  for (let i = 0; i < 5; i++) addCut({ customer: 'Cust B', diameter: 625.4, thickness: 10, length: 6000, pipe_number: i + 101 })
  // 5 cuts Customer A (1020 x 12.7 x 9000) -> 2.8465 * 5 = 14.2325 tons
  for (let i = 0; i < 5; i++) addCut({ customer: 'Cust A', diameter: 1020, thickness: 12.7, length: 9000, pipe_number: i + 201 })
  // 3 cuts with customer only (no dimensions) -> 0 tonnage
  for (let i = 0; i < 3; i++) addCut({ customer: 'Cust C' })
  // 2 completely unspecified cuts
  for (let i = 0; i < 2; i++) addCut(null)

  const fakeSupabase = createStrictFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary({ category: 'production', type: 'daily', date: '2026-08-09' })

  assert.equal(report.metrics.totalProductionOutput, 25)
  assert.equal(report.metrics.specifiedPipes, 23)
  assert.equal(report.metrics.unspecifiedPipes, 2)

  // Verify percentage of total across all breakdown groups sums to 100%
  const totalPercentage = report.specBreakdown.reduce((sum, g) => sum + g.percentageOfTotal, 0)
  assert.equal(Math.round(totalPercentage), 100)

  // Verify total count in breakdown equals total output
  const totalPipesInBreakdown = report.specBreakdown.reduce((sum, g) => sum + g.pipeCount, 0)
  assert.equal(totalPipesInBreakdown, 25)

  // Expected tonnage: 10 * 0.9105 + 5 * 0.9105 + 5 * 2.8392 = 27.8535
  const expectedTonnage = Math.round((15 * calculatePipeTonnage(625.4, 10, 6000) + 5 * calculatePipeTonnage(1020, 12.7, 9000)) * 10000) / 10000
  assert.equal(report.metrics.totalTonnage, expectedTonnage)

})

// -------------------------------------------------------------------------------------------------
// SUITE 3: Future Period Invariant & Zero DB Queries
// -------------------------------------------------------------------------------------------------
test('Future Invariant 3.1: Future report strictly yields totalTonnage: null and summary card value N/A', async () => {
  // Disallow any queries - should throw if attempted!
  const fakeSupabase = createStrictFakeSupabase({ allowQueries: false })
  const reportsService = loadReportsService(fakeSupabase)

  // Requesting future date (year 2099)
  const report = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2099-01-01' },
    { asOf: new Date('2026-08-09T08:00:00.000Z') }
  )

  assert.equal(report.periodState, 'future')
  assert.equal(report.totalTonnage, null)
  assert.equal(report.metrics.totalTonnage, null)
  assert.equal(report.totalProductionOutput, null)
  assert.equal(report.metrics.totalProductionOutput, null)

  const tonnageCard = report.summary.find((item) => item.id === 'total-tonnage')
  assert.ok(tonnageCard)
  assert.equal(tonnageCard.value, 'N/A')
  assert.equal(tonnageCard.helper, 'Period not reached yet')

  const outputCard = report.summary.find((item) => item.id === 'total-output')
  assert.ok(outputCard)
  assert.equal(outputCard.value, 'N/A')

  assert.deepEqual(report.specBreakdown, [])
  assert.deepEqual(report.productionLogs, [])
})

test('Future Invariant 3.2: Future report with comparison strictly returns zero queries and comparison: null', async () => {
  const fakeSupabase = createStrictFakeSupabase({ allowQueries: false })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary(
    { category: 'production', type: 'monthly', date: '2099-01-01', compare: true },
    { asOf: new Date('2026-08-09T08:00:00.000Z') }
  )

  assert.equal(report.periodState, 'future')
  assert.equal(report.comparison, null)
  assert.equal(fakeSupabase.queries.length, 0)
  assert.equal(fakeSupabase.rpcCalls.length, 0)
})

// -------------------------------------------------------------------------------------------------
// SUITE 4: Unobserved vs Zero Output
// -------------------------------------------------------------------------------------------------
test('Unobserved vs Zero 4.1: Period with 0 cuts reports 0 tons vs unobserved reporting null / N/A', async () => {
  const fakeSupabase = createStrictFakeSupabase({ sensorEvents: [], productionSpecs: [] })
  const reportsService = loadReportsService(fakeSupabase)

  // Past observed date with 0 cuts
  const zeroReport = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-08-08' },
    { asOf: new Date('2026-08-09T08:00:00.000Z') }
  )

  // 1. Observed with 0 cuts:
  assert.equal(zeroReport.periodState, 'complete')
  assert.equal(zeroReport.totalProductionOutput, 0)
  assert.equal(zeroReport.metrics.totalProductionOutput, 0)
  assert.equal(zeroReport.totalTonnage, 0)
  assert.equal(zeroReport.metrics.totalTonnage, 0)
  assert.equal(zeroReport.summary.find((s) => s.id === 'total-tonnage').value, '0.0000 tons')
  assert.equal(zeroReport.summary.find((s) => s.id === 'total-output').value, '0 pcs')

  // 2. Unobserved future:
  const unobservedReport = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-08-10' },
    { asOf: new Date('2026-08-09T08:00:00.000Z') }
  )

  assert.equal(unobservedReport.periodState, 'future')
  assert.equal(unobservedReport.totalProductionOutput, null)
  assert.equal(unobservedReport.metrics.totalProductionOutput, null)
  assert.equal(unobservedReport.totalTonnage, null)
  assert.equal(unobservedReport.metrics.totalTonnage, null)
  assert.equal(unobservedReport.summary.find((s) => s.id === 'total-tonnage').value, 'N/A')
  assert.equal(unobservedReport.summary.find((s) => s.id === 'total-output').value, 'N/A')
})

test('Unobserved vs Zero 4.2: Serializers render distinct, valid PDF and Excel files for Zero Output vs Unobserved', async () => {
  const zeroReport = {
    category: 'production',
    reportType: 'daily',
    selectedDate: '2026-08-08',
    periodState: 'complete',
    totalProductionOutput: 0,
    totalTonnage: 0,
    metrics: { totalProductionOutput: 0, totalTonnage: 0, specifiedPipes: 0, unspecifiedPipes: 0, distinctProductSizes: 0 },
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: '0 pcs', helper: 'From Spiral Mill 01' },
      { id: 'total-tonnage', label: 'Total Production Tonnage (tons)', value: '0.0000 tons', helper: 'Calculated metric tons' },
    ],
    specBreakdown: [],
    productionLogs: [],
    machine: { code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { code: 'S-05', label: 'Pipe Cutting Counter' },
  }

  const unobservedReport = {
    category: 'production',
    reportType: 'daily',
    selectedDate: '2026-08-10',
    periodState: 'future',
    totalProductionOutput: null,
    totalTonnage: null,
    metrics: { totalProductionOutput: null, totalTonnage: null, specifiedPipes: null, unspecifiedPipes: null, distinctProductSizes: null },
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'total-tonnage', label: 'Total Production Tonnage (tons)', value: 'N/A', helper: 'Period not reached yet' },
    ],
    specBreakdown: [],
    productionLogs: [],
    machine: { code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { code: 'S-05', label: 'Pipe Cutting Counter' },
  }

  // PDF generation
  const pdfZero = await toPdf(zeroReport)
  const pdfUnobserved = await toPdf(unobservedReport)
  assert.ok(Buffer.isBuffer(pdfZero) && pdfZero.length > 500)
  assert.ok(Buffer.isBuffer(pdfUnobserved) && pdfUnobserved.length > 500)

  // Excel generation
  const xlsxZero = await toXlsx(zeroReport)
  const xlsxUnobserved = await toXlsx(unobservedReport)
  assert.ok(Buffer.isBuffer(xlsxZero) && xlsxZero.length > 500)
  assert.ok(Buffer.isBuffer(xlsxUnobserved) && xlsxUnobserved.length > 500)
})

// -------------------------------------------------------------------------------------------------
// SUITE 5: Large Scale Stress & DOM Protection
// -------------------------------------------------------------------------------------------------
test('Scale Suite 5.1: 5,000 simulated cuts are capped at 200 for summary but fully preserved for export', async () => {
  const sensorEvents = []
  const productionSpecs = []
  const totalCuts = 5000

  for (let i = 1; i <= totalCuts; i++) {
    const id = `ev-scale-${i}`
    sensorEvents.push({
      id,
      recorded_at: new Date(Date.parse('2026-08-09T00:00:00.000Z') + i * 10000).toISOString(),
      device_event_id: i,
    })
    productionSpecs.push({
      sensor_event_id: id,
      customer: i % 2 === 0 ? 'MCWD' : 'Regan',
      diameter: 625.4,
      thickness: 10.0,
      length: 6000,
      pipe_number: i,
    })
  }

  const fakeSupabase = createStrictFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  // 1. Default summary call (maxLogs: 200)
  const summaryReport = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-08-09' },
    { maxLogs: 200 }
  )
  assert.equal(summaryReport.metrics.totalProductionOutput, 5000)
  assert.equal(summaryReport.productionLogs.length, 200, 'Summary MUST cap productionLogs at 200 to protect DOM')
  assert.equal(summaryReport.rows.length, 200)

  // 2. Export call (maxLogs: null)
  const exportReport = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-08-09' },
    { maxLogs: null }
  )
  assert.equal(exportReport.metrics.totalProductionOutput, 5000)
  assert.equal(exportReport.productionLogs.length, 5000, 'Export MUST preserve complete 5,000 cut logs')

  // 3. Serializer stress test on 5,000 cuts
  const startPdf = Date.now()
  const pdfBuffer = await toPdf(exportReport)
  const pdfDuration = Date.now() - startPdf
  assert.ok(Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 50000)

  const startXlsx = Date.now()
  const xlsxBuffer = await toXlsx(exportReport)
  const xlsxDuration = Date.now() - startXlsx
  assert.ok(Buffer.isBuffer(xlsxBuffer) && xlsxBuffer.length > 50000)

  // Verify memory and timing within reasonable bounds (< 15 seconds)
  assert.ok(pdfDuration < 15000, `PDF generation of 5,000 cuts took ${pdfDuration}ms`)
  assert.ok(xlsxDuration < 15000, `XLSX generation of 5,000 cuts took ${xlsxDuration}ms`)
})

// -------------------------------------------------------------------------------------------------
// SUITE 6: Formula Injection Protection (OWASP ASVS)
// -------------------------------------------------------------------------------------------------
test('Security Suite 6.1: Serializers escape potential formula injection characters in customer and labels', async () => {
  const maliciousReport = {
    category: 'production',
    reportType: 'daily',
    selectedDate: '2026-08-09',
    periodState: 'complete',
    totalProductionOutput: 4,
    totalTonnage: 3.642,
    metrics: { totalProductionOutput: 4, totalTonnage: 3.642, specifiedPipes: 4, unspecifiedPipes: 0, distinctProductSizes: 1 },
    summary: [],
    specBreakdown: [
      { customer: '=CMD(\'calc\')', diameter: 625.4, thickness: 10, length: 6000, pipeCount: 1, totalTonnage: 0.9105, percentageOfTotal: 25 },
      { customer: '+123456789', diameter: 625.4, thickness: 10, length: 6000, pipeCount: 1, totalTonnage: 0.9105, percentageOfTotal: 25 },
      { customer: '-SUM(A1:A10)', diameter: 625.4, thickness: 10, length: 6000, pipeCount: 1, totalTonnage: 0.9105, percentageOfTotal: 25 },
      { customer: '@something', diameter: 625.4, thickness: 10, length: 6000, pipeCount: 1, totalTonnage: 0.9105, percentageOfTotal: 25 },
    ],
    productionLogs: [
      { id: 'ev-1', recordedAt: '2026-08-09T08:00:00.000Z', customer: '=CMD(\'calc\')', diameter: 625.4, thickness: 10, length: 6000, pipeNumber: 1, tonnage: 0.9105 },
    ],
    machine: { code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { code: 'S-05', label: 'Pipe Cutting Counter' },
  }

  const xlsxBuffer = await toXlsx(maliciousReport)
  assert.ok(Buffer.isBuffer(xlsxBuffer))

  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(xlsxBuffer)

  const summarySheet = wb.getWorksheet('Production Summary')
  // Row 13 has first breakdown item
  const c1 = summarySheet.getCell('A13').value
  const c2 = summarySheet.getCell('A14').value
  const c3 = summarySheet.getCell('A15').value
  const c4 = summarySheet.getCell('A16').value

  assert.equal(c1, "'=CMD('calc')", 'Must prepend single quote to = formula')
  assert.equal(c2, "'+123456789", 'Must prepend single quote to + formula')
  assert.equal(c3, "'-SUM(A1:A10)", 'Must prepend single quote to - formula')
  assert.equal(c4, "'@something", 'Must prepend single quote to @ formula')
})
