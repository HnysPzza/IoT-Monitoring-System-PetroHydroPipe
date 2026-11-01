const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const ExcelJS = require('exceljs')

const reportsRepository = require('../../src/modules/reports/reports.repository')
const { toXlsx } = require('../../src/modules/reports/reportsXlsx.serializer')
const { buildExportFilename, toPdf } = require('../../src/modules/reports/reportsExport.serializer')

const backendRoot = path.resolve(__dirname, '../..')
const MACHINE_ID = '11111111-1111-4111-8111-111111111111'

function loadReportsService(mockSupabase) {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes('reports.service') || key.includes('reports.repository') || key.includes('client')) {
      delete require.cache[key]
    }
  })

  const clientPath = path.join(backendRoot, 'src/database/client.js')
  require.cache[require.resolve(clientPath)] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      getSupabaseClient: () => mockSupabase,
    },
  }

  return require('../../src/modules/reports/reports.service')
}

function createFakeSupabase({
  sensorEvents = [],
  productionSpecs = [],
  sensorConfig = {
    id: 'sensor-s05-id',
    sensor_code: 'S-05',
    label: 'Pipe Cutting Counter',
    machine_id: MACHINE_ID,
    machines: { id: MACHINE_ID, machine_code: 'M-01', name: 'Spiral Mill 01' },
  },
} = {}) {
  return {
    from(tableName) {
      if (tableName === 'sensors') {
        return {
          select() { return this },
          eq() { return this },
          maybeSingle: async () => ({ data: sensorConfig, error: null }),
        }
      }
      if (tableName === 'machines') {
        return {
          select() { return this },
          eq() { return this },
          maybeSingle: async () => ({ data: { id: MACHINE_ID, name: 'Spiral Mill 01', machine_code: 'M-01' }, error: null }),
        }
      }
      if (tableName === 'sensor_events') {
        return {
          select() { return this },
          eq() { return this },
          gte() { return this },
          lt() { return this },
          order() { return this },
          range: async (from, to) => {
            const slice = sensorEvents.slice(from, to + 1)
            return { data: slice, error: null }
          },
        }
      }
      if (tableName === 'production_item_specs') {
        return {
          select() { return this },
          in: async (col, ids) => {
            const matches = productionSpecs.filter((s) => ids.includes(s.sensor_event_id))
            return { data: matches, error: null }
          },
        }
      }
      return {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lt() { return this },
        order() { return this },
        range: async () => ({ data: [], error: null }),
      }
    },
  }
}

// -------------------------------------------------------------
// CHALLENGE 1: Spec dimension parsing with adversarial inputs
// -------------------------------------------------------------
test('CHALLENGE 1: Spec dimension parsing with adversarial inputs', async () => {
  const adversarialValues = [
    { input: '   ', expectedNull: true },
    { input: '', expectedNull: true },
    { input: '0', expectedNull: true },
    { input: 0, expectedNull: true },
    { input: -1, expectedNull: true },
    { input: '-10', expectedNull: true },
    { input: null, expectedNull: true },
    { input: undefined, expectedNull: true },
    { input: NaN, expectedNull: true },
    { input: Infinity, expectedNull: true },
    { input: -Infinity, expectedNull: true },
    { input: '10.5', expectedVal: 10.5 },
    { input: 10.5, expectedVal: 10.5 },
    { input: ' 10.5 ', expectedVal: 10.5 },
    { input: '10.5px', expectedNull: true },
    { input: '-0', expectedNull: true },
  ]

  const sensorEvents = []
  const productionSpecs = []

  adversarialValues.forEach((item, idx) => {
    const id = `ev-dim-${idx}`
    sensorEvents.push({
      id,
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: idx,
      event_type: 'pulse',
      recorded_at: `2026-08-09T01:${String(idx).padStart(2, '0')}:00.000Z`,
      output_accepted: true,
    })
    productionSpecs.push({
      sensor_event_id: id,
      label: `Adversarial Item ${idx}`,
      size: null,
      diameter: item.input,
      radius: item.input,
      circumference: item.input,
    })
  })

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-08-09' },
    { maxLogs: null, asOf: new Date('2026-08-10T00:00:00.000Z') },
  )

  assert.equal(report.totalProductionOutput, adversarialValues.length)

  adversarialValues.forEach((item, idx) => {
    const log = report.productionLogs.find((l) => l.deviceEventId === idx)
    assert.ok(log, `Log for deviceEventId ${idx} must exist`)

    if (item.expectedNull) {
      assert.equal(
        log.diameter,
        null,
        `Expected diameter for input ${JSON.stringify(item.input)} to be null, got ${log.diameter}`,
      )
      assert.equal(
        log.radius,
        null,
        `Expected radius for input ${JSON.stringify(item.input)} to be null, got ${log.radius}`,
      )
      assert.equal(
        log.circumference,
        null,
        `Expected circumference for input ${JSON.stringify(item.input)} to be null, got ${log.circumference}`,
      )
    } else {
      assert.equal(
        log.diameter,
        item.expectedVal,
        `Expected diameter for input ${JSON.stringify(item.input)} to be ${item.expectedVal}, got ${log.diameter}`,
      )
      assert.equal(
        log.radius,
        item.expectedVal,
        `Expected radius for input ${JSON.stringify(item.input)} to be ${item.expectedVal}, got ${log.radius}`,
      )
      assert.equal(
        log.circumference,
        item.expectedVal,
        `Expected circumference for input ${JSON.stringify(item.input)} to be ${item.expectedVal}, got ${log.circumference}`,
      )
    }
  })
})

// -------------------------------------------------------------
// CHALLENGE 2: distinctSizeKey grouping and priority hierarchy
// -------------------------------------------------------------
test('CHALLENGE 2: distinctSizeKey grouping (identical specs with different labels & priority order)', async () => {
  const sensorEvents = [
    // Case A: Identical dimensions and size, but different labels (Heat A vs Heat B)
    { id: 'ev-1', sensor_id: 'sensor-s05-id', device_event_id: 1, event_type: 'pulse', recorded_at: '2026-08-09T01:00:00.000Z', output_accepted: true },
    { id: 'ev-2', sensor_id: 'sensor-s05-id', device_event_id: 2, event_type: 'pulse', recorded_at: '2026-08-09T01:05:00.000Z', output_accepted: true },

    // Case B: Identical dimensions, no size, different labels (Heat C vs Heat D)
    { id: 'ev-3', sensor_id: 'sensor-s05-id', device_event_id: 3, event_type: 'pulse', recorded_at: '2026-08-09T01:10:00.000Z', output_accepted: true },
    { id: 'ev-4', sensor_id: 'sensor-s05-id', device_event_id: 4, event_type: 'pulse', recorded_at: '2026-08-09T01:15:00.000Z', output_accepted: true },

    // Case C: Only label, no size and no dimensions
    { id: 'ev-5', sensor_id: 'sensor-s05-id', device_event_id: 5, event_type: 'pulse', recorded_at: '2026-08-09T01:20:00.000Z', output_accepted: true },
    { id: 'ev-6', sensor_id: 'sensor-s05-id', device_event_id: 6, event_type: 'pulse', recorded_at: '2026-08-09T01:25:00.000Z', output_accepted: true },

    // Case D: Item with Size X and Dimensions Y vs Item with Size X and different Dimensions Z
    // Priority: size > dimensions, so both have size X and must group under the same distinct size!
    { id: 'ev-7', sensor_id: 'sensor-s05-id', device_event_id: 7, event_type: 'pulse', recorded_at: '2026-08-09T01:30:00.000Z', output_accepted: true },
    { id: 'ev-8', sensor_id: 'sensor-s05-id', device_event_id: 8, event_type: 'pulse', recorded_at: '2026-08-09T01:35:00.000Z', output_accepted: true },
  ]

  const productionSpecs = [
    // Case A: Size '8 inch' with different labels
    { sensor_event_id: 'ev-1', label: 'Heat A', size: '8 inch', diameter: 219.08, radius: 109.54, circumference: 688.26 },
    { sensor_event_id: 'ev-2', label: 'Heat B', size: '8 inch', diameter: 219.08, radius: 109.54, circumference: 688.26 },

    // Case B: No size, identical dimensions (168.28), different labels
    { sensor_event_id: 'ev-3', label: 'Heat C', size: null, diameter: 168.28, radius: 84.14, circumference: 528.67 },
    { sensor_event_id: 'ev-4', label: 'Heat D', size: '', diameter: 168.28, radius: 84.14, circumference: 528.67 },

    // Case C: Only label 'Custom Structural Pipe'
    { sensor_event_id: 'ev-5', label: 'Custom Structural Pipe', size: null, diameter: null, radius: null, circumference: null },
    { sensor_event_id: 'ev-6', label: 'Custom Structural Pipe', size: '', diameter: 0, radius: -5, circumference: '' },

    // Case D: Same size '10 inch', different dimensions
    { sensor_event_id: 'ev-7', label: 'Batch 1', size: '10 inch', diameter: 273.05, radius: 136.52, circumference: 857.82 },
    { sensor_event_id: 'ev-8', label: 'Batch 2', size: '10 inch', diameter: 275.0, radius: 137.5, circumference: 863.94 },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-08-09' },
    { maxLogs: null, asOf: new Date('2026-08-10T00:00:00.000Z') },
  )

  assert.equal(report.totalProductionOutput, 8)
  assert.equal(report.specifiedPipes, 8)
  assert.equal(report.unspecifiedPipes, 0)

  // Expected distinct sizes:
  // 1: ['size', '8 inch'] (ev-1 & ev-2)
  // 2: ['dimensions', 168.28, 84.14, 528.67] (ev-3 & ev-4)
  // 3: ['label', 'Custom Structural Pipe'] (ev-5 & ev-6)
  // 4: ['size', '10 inch'] (ev-7 & ev-8)
  // Total distinct sizes MUST be exactly 4!
  assert.equal(
    report.distinctProductSizes,
    4,
    `Expected 4 distinct sizes across the 8 items, got ${report.distinctProductSizes}`,
  )
})

// -------------------------------------------------------------
// CHALLENGE 3: Sequence 0 preservation in cut logs, XLSX, and PDF
// -------------------------------------------------------------
test('CHALLENGE 3: Sequence 0 preservation across cut logs, XLSX, and PDF', async () => {
  const sensorEvents = [
    {
      id: 'evt-seq-0-numeric',
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: 0, // Numeric sequence 0
      event_type: 'pulse',
      recorded_at: '2026-08-09T01:00:00.000Z',
      output_accepted: true,
    },
    {
      id: 'evt-seq-0-string',
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: '0', // String sequence "0"
      event_type: 'pulse',
      recorded_at: '2026-08-09T01:01:00.000Z',
      output_accepted: true,
    },
  ]

  const productionSpecs = [
    { sensor_event_id: 'evt-seq-0-numeric', label: 'Pipe 0-Num', size: '6 inch', diameter: 168.28, radius: 84.14, circumference: 528.67 },
    { sensor_event_id: 'evt-seq-0-string', label: 'Pipe 0-Str', size: '6 inch', diameter: 168.28, radius: 84.14, circumference: 528.67 },
  ]

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  const report = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-08-09' },
    { maxLogs: null, asOf: new Date('2026-08-10T00:00:00.000Z') },
  )

  // 1. Service cut logs verification
  const log0Num = report.productionLogs.find((l) => l.id === 'evt-seq-0-numeric')
  const log0Str = report.productionLogs.find((l) => l.id === 'evt-seq-0-string')

  assert.strictEqual(log0Num.deviceEventId, 0, 'Numeric 0 must be preserved strictly as 0')
  assert.strictEqual(log0Str.deviceEventId, '0', 'String "0" must be preserved strictly as "0"')

  // 2. XLSX serializer verification
  const xlsxBuffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)

  const logsSheet = workbook.getWorksheet('Production Cut Logs')
  assert.ok(logsSheet, 'Production Cut Logs worksheet must exist')

  const row6EventRef = logsSheet.getCell('B6').value
  const row7EventRef = logsSheet.getCell('B7').value

  assert.strictEqual(row6EventRef, 0, `XLSX cell B6 for numeric sequence 0 must be 0, got ${row6EventRef}`)
  assert.strictEqual(row7EventRef, '0', `XLSX cell B7 for string sequence "0" must be "0", got ${row7EventRef}`)

  // 3. PDF serializer verification
  const pdfBuffer = await toPdf(report)
  assert.ok(Buffer.isBuffer(pdfBuffer))
  assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

// -------------------------------------------------------------
// CHALLENGE 4: Formula injection defense in reportsXlsx.serializer.js
// -------------------------------------------------------------
test('CHALLENGE 4: Formula injection defense in XLSX across all user-controlled strings', async () => {
  const injectionStrings = [
    '=SUM(A1:A10)',
    '+CMD|\' /C calc\'!A0',
    '-5+2',
    '@SUM(B1:B5)',
    'Normal Pipe Label',
    '=1+1',
    '+441234567890',
    '-10% Discount',
    '@user_mention',
  ]

  const specBreakdown = injectionStrings.map((str, idx) => ({
    label: str,
    size: str,
    diameter: 100,
    radius: 50,
    circumference: 314.16,
    isSpecified: true,
    pipeCount: 1,
    percentageOfTotal: 10,
    firstCutAt: '2026-09-02T01:00:00.000Z',
    lastCutAt: '2026-09-02T02:00:00.000Z',
  }))

  const productionLogs = injectionStrings.map((str, idx) => ({
    id: `evt-${idx}`,
    deviceEventId: str, // If deviceEventId is string with formula
    recordedAt: '2026-09-02T01:00:00.000Z',
    label: str,
    size: str,
    diameter: 100,
    radius: 50,
    circumference: 314.16,
    isSpecified: true,
  }))

  const report = {
    category: 'production',
    generatedAt: '2026-09-03T01:23:45.678Z',
    reportType: 'daily',
    selectedDate: '2026-09-02',
    periodState: 'complete',
    machine: { id: 'm-1', code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { id: 's-5', code: 'S-05', label: 'S-05 Cutting Sensor' },
    metrics: {
      totalProductionOutput: injectionStrings.length,
      specifiedPipes: injectionStrings.length,
      unspecifiedPipes: 0,
      distinctProductSizes: 1,
    },
    totalProductionOutput: injectionStrings.length,
    specifiedPipes: injectionStrings.length,
    unspecifiedPipes: 0,
    distinctProductSizes: 1,
    specBreakdown,
    productionLogs,
  }

  const xlsxBuffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  const logsSheet = workbook.getWorksheet('Production Cut Logs')

  injectionStrings.forEach((str, idx) => {
    const summaryRow = summarySheet.getRow(13 + idx)
    const logsRow = logsSheet.getRow(6 + idx)

    const expectedEscaped = /^[=+@-]/.test(str) ? `'${str}` : str

    // Check summary breakdown label & size
    assert.strictEqual(
      summaryRow.getCell(1).value,
      expectedEscaped,
      `Summary Breakdown Label for "${str}" must be escaped to "${expectedEscaped}"`,
    )
    assert.strictEqual(
      summaryRow.getCell(2).value,
      expectedEscaped,
      `Summary Breakdown Size for "${str}" must be escaped to "${expectedEscaped}"`,
    )

    // Check cut logs eventRef, label, and size
    assert.strictEqual(
      logsRow.getCell(2).value,
      expectedEscaped,
      `Cut Log EventRef for "${str}" must be escaped to "${expectedEscaped}"`,
    )
    assert.strictEqual(
      logsRow.getCell(3).value,
      expectedEscaped,
      `Cut Log Label for "${str}" must be escaped to "${expectedEscaped}"`,
    )
    assert.strictEqual(
      logsRow.getCell(4).value,
      expectedEscaped,
      `Cut Log Size for "${str}" must be escaped to "${expectedEscaped}"`,
    )
  })
})

// -------------------------------------------------------------
// CHALLENGE 5: Pagination limit handling in reports.repository.js
// -------------------------------------------------------------
test('CHALLENGE 5: Pagination limit handling in reports.repository.js (boundary conditions)', async () => {
  // Case A: Exactly 200 pages with 500 items each (100,000 items) -> should trigger LIMIT_EXCEEDED
  let pageCounterA = 0
  const fakeClientExceeding = {
    from() {
      return {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lt() { return this },
        order() { return this },
        range: async () => {
          pageCounterA += 1
          // Return full page of 500 records on every call
          return {
            data: Array.from({ length: 500 }, (_, i) => ({
              id: `ev-pg-${pageCounterA}-${i}`,
              sensor_id: 's-1',
              recorded_at: '2026-08-09T01:00:00.000Z',
              output_accepted: true,
            })),
            error: null,
          }
        },
      }
    },
  }

  await assert.rejects(
    async () => reportsRepository.findAcceptedCuttingEvents({
      sensorId: 's-1',
      startIso: '2026-08-09T00:00:00.000Z',
      endIso: '2026-08-10T00:00:00.000Z',
    }, fakeClientExceeding),
    (err) => {
      assert.equal(err.code, 'REPORT_PRODUCTION_EVENT_LIMIT_EXCEEDED')
      assert.equal(err.status, 500)
      return true
    },
  )

  // Case B: At page 200, page has length 499 (< PAGE_SIZE) -> exactly 99,999 items -> should SUCCEED without error
  let pageCounterB = 0
  const fakeClientUnderCap = {
    from() {
      return {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lt() { return this },
        order() { return this },
        range: async () => {
          pageCounterB += 1
          const length = pageCounterB === 200 ? 499 : 500
          return {
            data: Array.from({ length }, (_, i) => ({
              id: `ev-pg-${pageCounterB}-${i}`,
              sensor_id: 's-1',
              recorded_at: '2026-08-09T01:00:00.000Z',
              output_accepted: true,
            })),
            error: null,
          }
        },
      }
    },
  }

  const events = await reportsRepository.findAcceptedCuttingEvents({
    sensorId: 's-1',
    startIso: '2026-08-09T00:00:00.000Z',
    endIso: '2026-08-10T00:00:00.000Z',
  }, fakeClientUnderCap)

  assert.equal(events.length, 199 * 500 + 499)
  assert.equal(pageCounterB, 200)
})

// -------------------------------------------------------------
// CHALLENGE 6: Filename sanitization in reportsExport.serializer.js
// -------------------------------------------------------------
test('CHALLENGE 6: Filename sanitization against malicious path traversal and injection', () => {
  const adversarialCases = [
    {
      input: { category: 'production', reportType: '../../etc/passwd', selectedDate: '2026-09-02', format: 'pdf' },
      expected: 'production-report-....etcpasswd-2026-09-02.pdf',
    },
    {
      input: { category: 'regular', reportType: 'daily\r\nSet-Cookie: evil=1', selectedDate: '2026-09-02', format: 'xlsx' },
      expected: 'report-dailySet-Cookieevil1-2026-09-02.xlsx',
    },
    {
      input: { category: 'production', reportType: 'daily', selectedDate: '2026-09-02; rm -rf /', format: 'pdf' },
      expected: 'production-report-daily-2026-09-02rm-rf.pdf',
    },
    {
      input: { category: 'production', reportType: 'daily', selectedDate: '2026-09-02\0hidden', format: 'pdf' },
      expected: 'production-report-daily-2026-09-02hidden.pdf',
    },
    {
      input: { category: 'regular', reportType: 'weekly', selectedDate: '2026-W36', format: 'xlsx' },
      expected: 'report-weekly-2026-W36.xlsx',
    },
    {
      input: { category: 'production', reportType: 'monthly', selectedDate: '', format: 'pdf' },
      expected: 'production-report-monthly-undated.pdf',
    },
  ]

  adversarialCases.forEach(({ input, expected }) => {
    const sanitized = buildExportFilename(input)
    assert.strictEqual(
      sanitized,
      expected,
      `Sanitization for ${JSON.stringify(input)} failed: got "${sanitized}", expected "${expected}"`,
    )
    // Check that NO prohibited characters exist: only [a-zA-Z0-9._-]
    assert.match(sanitized, /^[a-zA-Z0-9._-]+$/)
  })
})

// -------------------------------------------------------------
// CHALLENGE 7: Chunking & Edge conditions in findProductionSpecsByEventIds
// -------------------------------------------------------------
test('CHALLENGE 7: findProductionSpecsByEventIds chunking boundary conditions', async () => {
  let chunksReceived = []
  const fakeClient = {
    from() {
      return {
        select() { return this },
        in: async (col, chunk) => {
          chunksReceived.push(chunk)
          return {
            data: chunk.map((id) => ({ sensor_event_id: id, label: `Spec for ${id}` })),
            error: null,
          }
        },
      }
    },
  }

  // Test 1: Empty array
  const emptyMap = await reportsRepository.findProductionSpecsByEventIds([], fakeClient)
  assert.equal(emptyMap.size, 0)

  // Test 2: Exactly 250 items with duplicates (should deduplicate and chunk in 100s: [100, 100, 50])
  chunksReceived = []
  const eventIds = Array.from({ length: 250 }, (_, i) => `id-${i % 150}`) // 150 unique IDs
  const resultMap = await reportsRepository.findProductionSpecsByEventIds(eventIds, fakeClient)

  assert.equal(resultMap.size, 150)
  assert.equal(chunksReceived.length, 2) // 150 unique IDs in chunks of 100 -> 2 chunks (100 and 50)
  assert.equal(chunksReceived[0].length, 100)
  assert.equal(chunksReceived[1].length, 50)
})
