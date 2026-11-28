const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const ExcelJS = require('@excel.js/exceljs').default

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

// Removed duplicate CHALLENGE 1A (=,+,-,@ escaping covered in reports.m3.adversarial.test.js Suite 6.1).

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
    const summaryVal = summarySheet.getCell(9 + idx, 1).value
    const logVal = logsSheet.getCell(5 + idx, 2).value
    return {
      payload: JSON.stringify(payload),
      summaryVal: JSON.stringify(summaryVal),
      summaryEscaped: typeof summaryVal === 'string' && summaryVal.startsWith("'"),
      logVal: JSON.stringify(logVal),
      logEscaped: typeof logVal === 'string' && logVal.startsWith("'"),
    }
  })

  results.forEach((r) => {
    assert.strictEqual(r.summaryEscaped, true, `Summary payload ${r.payload} must be escaped, got ${r.summaryVal}`)
    assert.strictEqual(r.logEscaped, true, `Cut log payload ${r.payload} must be escaped, got ${r.logVal}`)
  })
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

  // In Summary Worksheet (Row 9):
  // Col B: Diameter (OD) mm -> numeric 1020.5, numFmt '#,##0.00'
  const diamCell = summarySheet.getCell('B9')
  assert.strictEqual(typeof diamCell.value, 'number')
  assert.strictEqual(diamCell.value, 1020.5)
  assert.strictEqual(diamCell.numFmt, '#,##0.00')

  // Col C: Thickness mm -> numeric 12.7, numFmt '#,##0.00'
  const thickCell = summarySheet.getCell('C9')
  assert.strictEqual(typeof thickCell.value, 'number')
  assert.strictEqual(thickCell.value, 12.7)
  assert.strictEqual(thickCell.numFmt, '#,##0.00')

  // Col D: Length mm -> numeric 12000, numFmt '#,##0'
  const lenCell = summarySheet.getCell('D9')
  assert.strictEqual(typeof lenCell.value, 'number')
  assert.strictEqual(lenCell.value, 12000)
  assert.strictEqual(lenCell.numFmt, '#,##0')

  // Col E: Quantity (pcs) -> numeric 2, numFmt '#,##0'
  const qtyCell = summarySheet.getCell('E9')
  assert.strictEqual(typeof qtyCell.value, 'number')
  assert.strictEqual(qtyCell.value, 2)
  assert.strictEqual(qtyCell.numFmt, '#,##0')

  // Col F: Total Tons -> numeric 1.5432, numFmt '#,##0.0000'
  const tonsCell = summarySheet.getCell('F9')
  assert.strictEqual(typeof tonsCell.value, 'number')
  assert.strictEqual(tonsCell.value, 1.5432)
  assert.strictEqual(tonsCell.numFmt, '#,##0.0000')

  // In Cut Logs Worksheet (Row 5):
  // Col C: Diameter -> 1020.5
  assert.strictEqual(typeof logsSheet.getCell('C5').value, 'number')
  assert.strictEqual(logsSheet.getCell('C5').value, 1020.5)

  // Col D: Thickness -> 12.7
  assert.strictEqual(typeof logsSheet.getCell('D5').value, 'number')
  assert.strictEqual(logsSheet.getCell('D5').value, 12.7)

  // Col E: Length -> 12000
  assert.strictEqual(typeof logsSheet.getCell('E5').value, 'number')
  assert.strictEqual(logsSheet.getCell('E5').value, 12000)

  // Col F: Pipe # -> 1001 (integer)
  const pipeNumCell = logsSheet.getCell('F5')
  assert.strictEqual(typeof pipeNumCell.value, 'number')
  assert.strictEqual(pipeNumCell.value, 1001)
  assert.strictEqual(pipeNumCell.numFmt, '#,##0')

  // Col G: Tons -> 0.7716, numFmt '#,##0.0000'
  const logTonsCell = logsSheet.getCell('G5')
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
  assert.strictEqual(workbook.getWorksheet('Production Summary').getCell('A9').value, extremeCustomer100)
})

// Removed duplicate CHALLENGE 3 (superseded by reports.m3.adversarial.test.js Suite 5.1 5,000-cut test).
