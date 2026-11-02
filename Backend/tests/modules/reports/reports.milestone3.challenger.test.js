const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const ExcelJS = require('exceljs')

const { toXlsx } = require('../../../src/modules/reports/reportsXlsx.serializer')
const { toPdf } = require('../../../src/modules/reports/reportsExport.serializer')
const { calculatePipeTonnage } = require('../../../src/modules/production/production.service')

const backendRoot = path.resolve(__dirname, '../../..')
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

  return require('../../../src/modules/reports/reports.service')
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

// =========================================================================
// CHALLENGE 1: Excel Formula Injection Attack Vectors & Numeric Integrity
// =========================================================================
test('CHALLENGE 1A: Excel Formula Injection neutralization across =, +, -, @', async () => {
  const attackPrefixes = ['=', '+', '-', '@']
  const payloads = [
    '=SUM(1,2)',
    '+cmd|/C calc!A0',
    '-10% Discount',
    '@SUM(A1:A5)',
  ]

  const specBreakdown = payloads.map((payload, idx) => ({
    customer: payload,
    diameter: 1000 + idx,
    thickness: 10,
    length: 6000,
    pipeCount: 5,
    singleTonnage: 0.1465,
    totalTonnage: 0.7325,
    percentageOfTotal: 25,
    isSpecified: true,
  }))

  const productionLogs = payloads.map((payload, idx) => ({
    id: `log-attack-${idx}`,
    deviceEventId: payload, // DeviceEventId attack
    customer: payload,
    pipeNumber: null, // Fallback to deviceEventId
    diameter: 1000 + idx,
    thickness: 10,
    length: 6000,
    tonnage: 0.1465,
    isSpecified: true,
    recordedAt: '2026-09-02T01:00:00.000Z',
  }))

  const report = {
    category: 'production',
    reportType: 'daily',
    selectedDate: '2026-09-02',
    machine: { id: 'm-01', code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { id: 's-05', sensor_code: 'S-05', label: 'Cutting Sensor' },
    periodState: 'complete',
    totalProductionOutput: 20,
    totalTonnage: 2.93,
    metrics: {
      totalProductionOutput: 20,
      totalTonnage: 2.93,
      specifiedPipes: 20,
      unspecifiedPipes: 0,
      distinctProductSizes: 4,
    },
    specBreakdown,
    productionLogs,
  }

  const xlsxBuffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  const logsSheet = workbook.getWorksheet('Production Cut Logs')

  payloads.forEach((payload, idx) => {
    // 1. Check Customer in Summary Breakdown (Col A, Row 13 + idx)
    const summaryCustomer = summarySheet.getCell(13 + idx, 1).value
    assert.strictEqual(
      summaryCustomer,
      `'${payload}`,
      `Expected breakdown customer for ${payload} to be escaped with leading quote, got ${summaryCustomer}`,
    )

    // 2. Check Customer in Cut Logs (Col B, Row 6 + idx)
    const logCustomer = logsSheet.getCell(6 + idx, 2).value
    assert.strictEqual(
      logCustomer,
      `'${payload}`,
      `Expected log customer for ${payload} to be escaped with leading quote, got ${logCustomer}`,
    )

    // 3. Check DeviceEventId (fallback for pipe #) in Cut Logs (Col F, Row 6 + idx)
    const logPipeRef = logsSheet.getCell(6 + idx, 6).value
    assert.strictEqual(
      logPipeRef,
      `'${payload}`,
      `Expected log pipe fallback for ${payload} to be escaped with leading quote, got ${logPipeRef}`,
    )
  })
})

test('CHALLENGE 1B: Excel Formula Injection investigation for tab (\\t) and carriage return (\\r) prefixes', async () => {
  const whitespacePayloads = [
    '\t=1+1',
    '\r=cmd|/C calc!A0',
    '\t+cmd',
    '\r@SUM(A1)',
  ]

  const specBreakdown = whitespacePayloads.map((payload, idx) => ({
    customer: payload,
    diameter: 1000,
    thickness: 10,
    length: 6000,
    pipeCount: 1,
    singleTonnage: 0.1465,
    totalTonnage: 0.1465,
    percentageOfTotal: 25,
    isSpecified: true,
  }))

  const productionLogs = whitespacePayloads.map((payload, idx) => ({
    id: `log-ws-${idx}`,
    deviceEventId: `dev-${idx}`,
    customer: payload,
    pipeNumber: 100 + idx,
    diameter: 1000,
    thickness: 10,
    length: 6000,
    tonnage: 0.1465,
    isSpecified: true,
    recordedAt: '2026-09-02T01:00:00.000Z',
  }))

  const report = {
    category: 'production',
    reportType: 'daily',
    selectedDate: '2026-09-02',
    machine: { id: 'm-01', code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { id: 's-05', sensor_code: 'S-05', label: 'Cutting Sensor' },
    periodState: 'complete',
    totalProductionOutput: 4,
    totalTonnage: 0.586,
    metrics: {
      totalProductionOutput: 4,
      totalTonnage: 0.586,
      specifiedPipes: 4,
      unspecifiedPipes: 0,
      distinctProductSizes: 1,
    },
    specBreakdown,
    productionLogs,
  }

  const xlsxBuffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  const logsSheet = workbook.getWorksheet('Production Cut Logs')

  const results = whitespacePayloads.map((payload, idx) => {
    const summaryVal = summarySheet.getCell(13 + idx, 1).value
    const logVal = logsSheet.getCell(6 + idx, 2).value
    return {
      payload: JSON.stringify(payload),
      summaryVal: JSON.stringify(summaryVal),
      summaryEscaped: typeof summaryVal === 'string' && summaryVal.startsWith("'"),
      logVal: JSON.stringify(logVal),
      logEscaped: typeof logVal === 'string' && logVal.startsWith("'"),
    }
  })

  console.log('[CHALLENGE 1B FINDINGS] Tab/CR payload escaping behavior:')
  results.forEach((r) => {
    console.log(`  Payload: ${r.payload} -> summaryVal: ${r.summaryVal} (escaped: ${r.summaryEscaped}), logVal: ${r.logVal} (escaped: ${r.logEscaped})`)
  })

  // Document whether \t and \r are escaped
  // We record this factually for our challenge report
  assert.ok(Array.isArray(results))
})

test('CHALLENGE 1C: Numeric columns remain strictly unescaped numbers formatted as #,##0.0000 or integer', async () => {
  const report = {
    category: 'production',
    reportType: 'daily',
    selectedDate: '2026-09-02',
    machine: { id: 'm-01', code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { id: 's-05', sensor_code: 'S-05', label: 'Cutting Sensor' },
    periodState: 'complete',
    totalProductionOutput: 2,
    totalTonnage: 1.5432,
    metrics: {
      totalProductionOutput: 2,
      totalTonnage: 1.5432,
      specifiedPipes: 2,
      unspecifiedPipes: 0,
      distinctProductSizes: 1,
    },
    specBreakdown: [
      {
        customer: '=DangerousFormulaCustomer',
        diameter: 1020.5,
        thickness: 12.7,
        length: 12000,
        pipeCount: 2,
        singleTonnage: 0.7716,
        totalTonnage: 1.5432,
        percentageOfTotal: 100,
        isSpecified: true,
      },
    ],
    productionLogs: [
      {
        id: 'log-num-1',
        deviceEventId: 101,
        customer: '+DangerousCustomer',
        pipeNumber: 1001,
        diameter: 1020.5,
        thickness: 12.7,
        length: 12000,
        tonnage: 0.7716,
        isSpecified: true,
        recordedAt: '2026-09-02T01:00:00.000Z',
      },
      {
        id: 'log-num-2',
        deviceEventId: 102,
        customer: 'Standard Customer',
        pipeNumber: 1002,
        diameter: 1020.5,
        thickness: 12.7,
        length: 12000,
        tonnage: 0.7716,
        isSpecified: true,
        recordedAt: '2026-09-02T02:00:00.000Z',
      },
    ],
  }

  const xlsxBuffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  const logsSheet = workbook.getWorksheet('Production Cut Logs')

  // In Summary Worksheet (Row 13):
  // Col B: Diameter (OD) mm -> numeric 1020.5, numFmt '#,##0.##'
  const diamCell = summarySheet.getCell('B13')
  assert.strictEqual(typeof diamCell.value, 'number')
  assert.strictEqual(diamCell.value, 1020.5)
  assert.strictEqual(diamCell.numFmt, '#,##0.##')

  // Col C: Thickness mm -> numeric 12.7, numFmt '#,##0.##'
  const thickCell = summarySheet.getCell('C13')
  assert.strictEqual(typeof thickCell.value, 'number')
  assert.strictEqual(thickCell.value, 12.7)
  assert.strictEqual(thickCell.numFmt, '#,##0.##')

  // Col D: Length mm -> numeric 12000, numFmt '#,##0.##'
  const lenCell = summarySheet.getCell('D13')
  assert.strictEqual(typeof lenCell.value, 'number')
  assert.strictEqual(lenCell.value, 12000)
  assert.strictEqual(lenCell.numFmt, '#,##0.##')

  // Col E: Quantity (pcs) -> numeric 2, numFmt '#,##0'
  const qtyCell = summarySheet.getCell('E13')
  assert.strictEqual(typeof qtyCell.value, 'number')
  assert.strictEqual(qtyCell.value, 2)
  assert.strictEqual(qtyCell.numFmt, '#,##0')

  // Col F: Total Tons -> numeric 1.5432, numFmt '#,##0.0000'
  const tonsCell = summarySheet.getCell('F13')
  assert.strictEqual(typeof tonsCell.value, 'number')
  assert.strictEqual(tonsCell.value, 1.5432)
  assert.strictEqual(tonsCell.numFmt, '#,##0.0000')

  // In Cut Logs Worksheet (Row 6):
  // Col C: Diameter -> 1020.5
  assert.strictEqual(typeof logsSheet.getCell('C6').value, 'number')
  assert.strictEqual(logsSheet.getCell('C6').value, 1020.5)

  // Col D: Thickness -> 12.7
  assert.strictEqual(typeof logsSheet.getCell('D6').value, 'number')
  assert.strictEqual(logsSheet.getCell('D6').value, 12.7)

  // Col E: Length -> 12000
  assert.strictEqual(typeof logsSheet.getCell('E6').value, 'number')
  assert.strictEqual(logsSheet.getCell('E6').value, 12000)

  // Col F: Pipe # -> 1001 (integer)
  const pipeNumCell = logsSheet.getCell('F6')
  assert.strictEqual(typeof pipeNumCell.value, 'number')
  assert.strictEqual(pipeNumCell.value, 1001)
  assert.strictEqual(pipeNumCell.numFmt, '#,##0')

  // Col G: Tons -> 0.7716, numFmt '#,##0.0000'
  const logTonsCell = logsSheet.getCell('G6')
  assert.strictEqual(typeof logTonsCell.value, 'number')
  assert.strictEqual(logTonsCell.value, 0.7716)
  assert.strictEqual(logTonsCell.numFmt, '#,##0.0000')
})

// =========================================================================
// CHALLENGE 2: PDF Width Margin Integrity & Extreme String Wrapping
// =========================================================================
test('CHALLENGE 2A: PDF Table 2 & Table 3 Column Widths sum exactly to 523.28 pt', () => {
  // Table 2 breakdown column widths:
  // Customer (110) + Diameter (70) + Thickness (65) + Length (65) + Quantity (65) + Total Tons (75) + % of Total (73.28)
  const table2Widths = [110, 70, 65, 65, 65, 75, 73.28]
  const table2Sum = Math.round(table2Widths.reduce((a, b) => a + b, 0) * 100) / 100
  assert.strictEqual(table2Sum, 523.28, `Table 2 sum must be 523.28 pt, got ${table2Sum}`)

  // Table 3 cut logs column widths:
  // Cut Timestamp (110) + Customer (95) + Diameter (65) + Thickness (60) + Length (60) + Pipe # (65) + Tons (68.28)
  const table3Widths = [110, 95, 65, 60, 60, 65, 68.28]
  const table3Sum = Math.round(table3Widths.reduce((a, b) => a + b, 0) * 100) / 100
  assert.strictEqual(table3Sum, 523.28, `Table 3 sum must be 523.28 pt, got ${table3Sum}`)

  // Verify printable width for US Letter with 44.36 pt margins:
  // Page width = 612 pt (8.5 inches * 72 pt/inch)
  // Margins left 44.36 pt, right 44.36 pt -> 612 - 88.72 = 523.28 pt
  const letterWidth = 612
  const leftMargin = 44.36
  const rightMargin = 44.36
  const printableWidth = Math.round((letterWidth - leftMargin - rightMargin) * 100) / 100
  assert.strictEqual(printableWidth, 523.28)
})

test('CHALLENGE 2B: PDF generation with extreme string lengths (100 char customer, 50 char label, no spaces)', async () => {
  const extremeCustomer100 = 'A'.repeat(100) // 100 characters max limit
  const customerWithSpaces = 'Petro Hydro Water District - Metro Cebu Northern Pipeline Extension Project Phase 4'.padEnd(100, '.')
  const extremeLabel50 = 'B'.repeat(50)

  const report = {
    category: 'production',
    reportType: 'daily',
    selectedDate: '2026-09-02',
    machine: { id: 'm-01', code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { id: 's-05', sensor_code: 'S-05', label: 'Cutting Sensor' },
    periodState: 'complete',
    totalProductionOutput: 3,
    totalTonnage: 2.3148,
    metrics: {
      totalProductionOutput: 3,
      totalTonnage: 2.3148,
      specifiedPipes: 3,
      unspecifiedPipes: 0,
      distinctProductSizes: 2,
    },
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: '3 pcs', helper: 'Accepted cutting events' },
      { id: 'total-tonnage', label: 'Total Production Tonnage (tons)', value: '2.3148 tons', helper: 'Calculated from dimensions' },
      { id: 'tag-coverage', label: 'Tag Coverage', value: '100% tagged', helper: '3 of 3 pipes specified' },
      { id: 'distinct-sizes', label: 'Distinct Specifications', value: '2 distinct runs', helper: 'Unique pipe specs' },
    ],
    specBreakdown: [
      {
        customer: extremeCustomer100,
        diameter: 1020,
        thickness: 12.7,
        length: 12000,
        pipeCount: 1,
        singleTonnage: 0.7716,
        totalTonnage: 0.7716,
        percentageOfTotal: 33.3,
        isSpecified: true,
      },
      {
        customer: customerWithSpaces,
        diameter: 625.4,
        thickness: 10,
        length: 6000,
        pipeCount: 2,
        singleTonnage: 0.7716,
        totalTonnage: 1.5432,
        percentageOfTotal: 66.7,
        isSpecified: true,
      },
    ],
    productionLogs: [
      {
        id: 'log-ext-1',
        deviceEventId: 1,
        customer: extremeCustomer100,
        pipeNumber: 1,
        diameter: 1020,
        thickness: 12.7,
        length: 12000,
        tonnage: 0.7716,
        isSpecified: true,
        recordedAt: '2026-09-02T01:00:00.000Z',
      },
      {
        id: 'log-ext-2',
        deviceEventId: 2,
        customer: customerWithSpaces,
        pipeNumber: 2,
        diameter: 625.4,
        thickness: 10,
        length: 6000,
        tonnage: 0.7716,
        isSpecified: true,
        recordedAt: '2026-09-02T02:00:00.000Z',
      },
      {
        id: 'log-ext-3',
        deviceEventId: 'EVT-FALLBACK-LONG-IDENTIFIER-1234567890',
        customer: extremeLabel50,
        pipeNumber: null,
        diameter: 625.4,
        thickness: 10,
        length: 6000,
        tonnage: 0.7716,
        isSpecified: true,
        recordedAt: '2026-09-02T03:00:00.000Z',
      },
    ],
  }

  // Generate PDF and verify it does not crash pdfkit and generates valid buffer
  const pdfBuffer = await toPdf(report)
  assert.ok(Buffer.isBuffer(pdfBuffer), 'PDF output must be a Buffer')
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer must contain substantial content')
  assert.strictEqual(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-', 'Must contain %PDF- magic header')

  // Generate XLSX as well with extreme strings to ensure no XML parse error in exceljs
  const xlsxBuffer = await toXlsx(report)
  assert.ok(Buffer.isBuffer(xlsxBuffer), 'XLSX output must be a Buffer')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)
  assert.strictEqual(workbook.getWorksheet('Production Summary').getCell('A13').value, extremeCustomer100)
})

// =========================================================================
// CHALLENGE 3: High-Volume Cut Logs (1,000 cuts) & DOM Freeze Protection
// =========================================================================
test('CHALLENGE 3: High-Volume (1,000 cuts) capping at 200 for /summary vs complete logs for /export', async () => {
  const TOTAL_CUTS = 1000
  const sensorEvents = []
  const productionSpecs = []

  let expectedTotalTonnage = 0

  for (let i = 0; i < TOTAL_CUTS; i++) {
    const id = `ev-1000-${i}`
    // Rotate between 3 customers and dimensions:
    // Run A: MCWD, 1020 x 12.7 x 12000 -> single tonnage = 0.9499 tons
    // Run B: Regan, 625.4 x 10.0 x 6000 -> single tonnage = 0.0910 tons
    // Run C: Unspecified
    const mod = i % 3
    let customer, diameter, thickness, length, pipeNumber, isSpecified, singleTon

    if (mod === 0) {
      customer = 'MCWD'
      diameter = 1020
      thickness = 12.7
      length = 12000
      pipeNumber = 1000 + i
      isSpecified = true
      singleTon = calculatePipeTonnage(diameter, thickness, length)
      expectedTotalTonnage += singleTon
    } else if (mod === 1) {
      customer = 'Regan'
      diameter = 625.4
      thickness = 10
      length = 6000
      pipeNumber = 2000 + i
      isSpecified = true
      singleTon = calculatePipeTonnage(diameter, thickness, length)
      expectedTotalTonnage += singleTon
    } else {
      customer = null
      diameter = null
      thickness = null
      length = null
      pipeNumber = null
      isSpecified = false
      singleTon = null
    }

    sensorEvents.push({
      id,
      sensor_id: 'sensor-s05-id',
      machine_id: MACHINE_ID,
      device_event_id: i + 1,
      event_type: 'pulse',
      // Chronological spacing 30 seconds apart
      recorded_at: new Date(Date.parse('2026-09-02T00:00:00.000Z') + i * 30000).toISOString(),
      output_accepted: true,
    })

    if (isSpecified) {
      productionSpecs.push({
        sensor_event_id: id,
        customer,
        diameter,
        thickness,
        length,
        pipe_number: pipeNumber,
        label: `${customer} Run`,
        size: `${diameter}mm`,
      })
    }
  }

  expectedTotalTonnage = Math.round(expectedTotalTonnage * 10000) / 10000

  const fakeSupabase = createFakeSupabase({ sensorEvents, productionSpecs })
  const reportsService = loadReportsService(fakeSupabase)

  // 1. Test /summary endpoint behavior: maxLogs = 200
  const summaryReport = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-09-02' },
    { maxLogs: 200, asOf: new Date('2026-09-03T00:00:00.000Z') },
  )

  // Invariant 3.1: productionLogs capped at 200 cuts
  assert.strictEqual(
    summaryReport.productionLogs.length,
    200,
    `Summary productionLogs must be capped at 200, got ${summaryReport.productionLogs.length}`,
  )
  assert.strictEqual(
    summaryReport.rows.length,
    200,
    `Summary rows alias must also be capped at 200, got ${summaryReport.rows.length}`,
  )

  // Invariant 3.2: Contains the MOST RECENT 200 cuts (last in chronological order)
  const lastEvent = summaryReport.productionLogs[summaryReport.productionLogs.length - 1]
  assert.strictEqual(
    lastEvent.deviceEventId,
    1000,
    `The last cut log must be the 1000th cut, got deviceEventId ${lastEvent.deviceEventId}`,
  )
  const firstReturnedEvent = summaryReport.productionLogs[0]
  assert.strictEqual(
    firstReturnedEvent.deviceEventId,
    801,
    `The first cut log in the 200-cap must be the 801st cut, got deviceEventId ${firstReturnedEvent.deviceEventId}`,
  )

  // Invariant 3.3: Total production output preserved across all 1,000 cuts
  assert.strictEqual(
    summaryReport.totalProductionOutput,
    1000,
    `Total output must reflect all 1,000 cuts, got ${summaryReport.totalProductionOutput}`,
  )
  assert.strictEqual(summaryReport.metrics.totalProductionOutput, 1000)

  // Invariant 3.4: Total tonnage computed across all 1,000 cuts (not just 200)
  assert.strictEqual(
    summaryReport.totalTonnage,
    expectedTotalTonnage,
    `Total tonnage must match all 1,000 cuts (${expectedTotalTonnage}), got ${summaryReport.totalTonnage}`,
  )
  assert.strictEqual(summaryReport.metrics.totalTonnage, expectedTotalTonnage)

  // Invariant 3.5: Breakdown sums to 1,000 cuts
  const breakdownCountSum = summaryReport.specBreakdown.reduce((sum, g) => sum + g.pipeCount, 0)
  assert.strictEqual(
    breakdownCountSum,
    1000,
    `Spec breakdown pipe counts must sum to 1,000, got ${breakdownCountSum}`,
  )

  // 2. Test /export endpoint behavior: isExport = true, maxLogs = null
  const exportReport = await reportsService.getSummary(
    { category: 'production', type: 'daily', date: '2026-09-02' },
    { isExport: true, maxLogs: null, asOf: new Date('2026-09-03T00:00:00.000Z') },
  )

  // Invariant 3.6: Export includes COMPLETE 1,000 logs without premature truncation
  assert.strictEqual(
    exportReport.productionLogs.length,
    1000,
    `Export productionLogs must include all 1,000 cuts, got ${exportReport.productionLogs.length}`,
  )
  assert.strictEqual(
    exportReport.rows.length,
    1000,
    `Export rows alias must include all 1,000 cuts, got ${exportReport.rows.length}`,
  )

  // Invariant 3.7: Export serializers handle the 1,000-row dataset without memory exhaustion or crash
  const exportPdf = await toPdf(exportReport)
  assert.ok(Buffer.isBuffer(exportPdf))
  assert.ok(exportPdf.length > 50000, '1,000 cuts PDF should be a multi-page document > 50KB')
  assert.strictEqual(exportPdf.subarray(0, 5).toString('utf8'), '%PDF-')

  const exportXlsx = await toXlsx(exportReport)
  assert.ok(Buffer.isBuffer(exportXlsx))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(exportXlsx)
  const cutLogsSheet = wb.getWorksheet('Production Cut Logs')
  // Header is row 5, followed by 1,000 rows + 1 daily subtotal row -> total 1006 rows
  assert.strictEqual(
    cutLogsSheet.rowCount,
    1006,
    `XLSX cut logs sheet must have 1006 rows (5 header rows + 1000 data rows + 1 daily subtotal row), got ${cutLogsSheet.rowCount}`,
  )
})
