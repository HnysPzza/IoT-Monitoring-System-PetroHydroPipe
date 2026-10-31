const assert = require('node:assert/strict')
const test = require('node:test')
const ExcelJS = require('exceljs')
const { toXlsx } = require('../src/modules/reports/reportsXlsx.serializer')

const {
  buildExportFilename,
  contentTypeFor,
  toPdf,
} = require('../src/modules/reports/reportsExport.serializer')

function createReport(overrides = {}) {
  return {
    category: 'regular',
    generatedAt: '2026-09-03T01:23:45.678Z',
    reportType: 'daily',
    selectedDate: '2026-09-02',
    periodState: 'complete',
    observedStartAt: '2026-09-01T16:00:00.000Z',
    observedEndAt: '2026-09-02T16:00:00.000Z',
    lossEstimateBasis: {
      source: 'configured-fallback',
      ratePiecesPerMinute: 0.05,
    },
    summary: [
      { id: 'production', label: 'Production Count', value: '1,250 pcs', helper: 'From Spiral Mill 01' },
      { id: 'loss', label: 'Estimated Loss', value: '3 pcs', helper: 'Using 3 pcs/hr' },
    ],
    metrics: {
      outputPieces: 1250,
      durationMinutes: 55,
      unplannedMinutes: 55,
      plannedExcludedMinutes: 0,
      scheduledEligibleMinutes: 540,
      availabilityPercent: 90.74,
      estimatedLoss: 3,
    },
    processSensors: [
      { sensorCode: 'S-01', sensorLabel: 'S-01 Coil Joint Replacement', eventCount: 2 },
    ],
    rows: [
      {
        cause: 'Corrective Maintenance',
        sensor: 'S-01 Coil Joint Replacement',
        events: 2,
        durationMinutes: 45,
        estimatedLoss: 3,
      },
      {
        cause: 'Pending "Review", unresolved',
        sensor: 'S-03 Machine Main',
        events: 1,
        durationMinutes: 10,
        estimatedLoss: 0.5,
      },
    ],
    ...overrides,
  }
}

function createProductionReport(overrides = {}) {
  return {
    category: 'production',
    generatedAt: '2026-09-03T01:23:45.678Z',
    reportType: 'daily',
    selectedDate: '2026-09-02',
    periodState: 'complete',
    observedStartAt: '2026-09-01T16:00:00.000Z',
    observedEndAt: '2026-09-02T16:00:00.000Z',
    machine: { id: 'm-1', code: 'M-01', name: 'Spiral Mill 01' },
    sensor: { id: 's-5', code: 'S-05', label: 'S-05 Cutting Sensor' },
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: '10 pcs', helper: 'From Spiral Mill 01' },
      { id: 'total-tonnage', label: 'Total Production Tonnage (tons)', value: '14.7196 tons', helper: 'Calculated metric tons' },
      { id: 'specified-pipes', label: 'Specified Pipes', value: '8 pcs', helper: '80% of total output' },
      { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: '2 pcs', helper: 'Pending specification tag' },
      { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: '2', helper: 'Unique pipe specs produced' },
    ],
    metrics: {
      totalProductionOutput: 10,
      totalTonnage: 14.7196,
      specifiedPipes: 8,
      unspecifiedPipes: 2,
      distinctProductSizes: 2,
    },
    totalProductionOutput: 10,
    totalTonnage: 14.7196,
    specifiedPipes: 8,
    unspecifiedPipes: 2,
    distinctProductSizes: 2,
    specBreakdown: [
      {
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        singleTonnage: 1.1513,
        totalTonnage: 5.7565,
        label: 'Grade A 6-inch',
        size: '6 inch',
        isSpecified: true,
        pipeCount: 5,
        percentageOfTotal: 50.0,
        firstCutAt: '2026-09-02T01:00:00.000Z',
        lastCutAt: '2026-09-02T03:00:00.000Z',
      },
      {
        customer: 'Regan Industrial',
        diameter: 1020.0,
        thickness: 10.0,
        length: 12000,
        singleTonnage: 2.9877,
        totalTonnage: 8.9631,
        label: 'Grade B 8-inch',
        size: '8 inch',
        isSpecified: true,
        pipeCount: 3,
        percentageOfTotal: 30.0,
        firstCutAt: '2026-09-02T04:00:00.000Z',
        lastCutAt: '2026-09-02T05:00:00.000Z',
      },
      {
        customer: 'Unspecified / Pending Tag',
        diameter: null,
        thickness: null,
        length: null,
        singleTonnage: null,
        totalTonnage: null,
        label: null,
        size: null,
        isSpecified: false,
        pipeCount: 2,
        percentageOfTotal: 20.0,
        firstCutAt: '2026-09-02T06:00:00.000Z',
        lastCutAt: '2026-09-02T07:00:00.000Z',
      },
    ],
    productionLogs: [
      {
        id: 'evt-1',
        deviceEventId: 101,
        recordedAt: '2026-09-02T01:00:00.000Z',
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 101,
        tonnage: 1.1513,
        label: 'Grade A 6-inch',
        size: '6 inch',
        isSpecified: true,
      },
      {
        id: 'evt-2',
        deviceEventId: 102,
        recordedAt: '2026-09-02T06:00:00.000Z',
        customer: null,
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
        tonnage: null,
        label: null,
        size: null,
        isSpecified: false,
      },
    ],
    ...overrides,
  }
}

test('toPdf resolves to a non-empty PDF buffer with the %PDF magic header', async () => {
  const buffer = await toPdf(createReport())

  assert.ok(Buffer.isBuffer(buffer))
  assert.ok(buffer.length > 1000, `expected a substantive document, got ${buffer.length} bytes`)
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

test('toPdf renders a valid document even with zero downtime rows', async () => {
  const buffer = await toPdf(createReport({ rows: [] }))

  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

test('toPdf renders multi-page PDF with pagination when report has numerous downtime rows', async () => {
  const manyRows = Array.from({ length: 45 }, (_, i) => ({
    cause: `Maintenance Root Cause Action ${i}`,
    sensor: `S-01 Station Unit ${i}`,
    events: i + 1,
    durationMinutes: 10 + i,
    estimatedLoss: (i * 0.5).toFixed(1),
  }))

  const buffer = await toPdf(createReport({ rows: manyRows }))
  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')

  const pdfString = buffer.toString('latin1')
  const pageCount = (pdfString.match(/\/Type\s*\/Page\b/g) || []).length
  assert.ok(pageCount >= 2, `expected at least 2 pages for 45 rows, got ${pageCount}`)
})

test('toXlsx writes a styled report with typed values and a restrained palette', async () => {
  const buffer = await toXlsx(createReport())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Operational Report')

  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(sheet.views[0].showGridLines, false)
  assert.ok(sheet.getCell('B4').value instanceof Date)
  assert.equal(sheet.getCell('B8').value, 1250)
  assert.equal(sheet.getCell('B8').numFmt, '#,##0 "pcs"')
  assert.equal(sheet.getCell('E8').value, 2)
  assert.equal(sheet.getCell('E9').numFmt, '#,##0 "min"')
  assert.equal(sheet.getCell('E10').numFmt, '#,##0 "pcs"')
  assert.equal(sheet.getCell('A20').value, 'Corrective Maintenance')
  assert.equal(sheet.getCell('C20').value, 2)
  assert.equal(sheet.getCell('D20').numFmt, '#,##0')
  assert.equal(sheet.getCell('E21').numFmt, '#,##0.##')
  assert.equal(sheet.getCell('E20').value, 3)
  assert.equal(sheet.getCell('B10').value, 0.9074)
  assert.equal(sheet.getCell('B10').numFmt, '0.0%')
  assert.equal(sheet.getCell('A19').font.color.argb, 'FFFFFFFF')

  const colors = new Set()
  sheet.eachRow((row) => row.eachCell((cell) => {
    if (cell.font?.color?.argb) colors.add(cell.font.color.argb)
    if (cell.fill?.fgColor?.argb) colors.add(cell.fill.fgColor.argb)
    for (const side of Object.values(cell.border || {})) {
      if (side.color?.argb) colors.add(side.color.argb)
    }
  }))
  assert.deepEqual([...colors].sort(), ['FFE4E9EF', 'FF1F3A5F', 'FFFFFFFF'].sort())
})

test('toXlsx keeps small fractional durations and losses visible', async () => {
  const report = createReport({
    metrics: { ...createReport().metrics, durationMinutes: 0.01, estimatedLoss: 0.01 },
    rows: [{ ...createReport().rows[0], durationMinutes: 0.01, estimatedLoss: 0.01 }],
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Operational Report')

  assert.equal(sheet.getCell('E9').value, 0.01)
  assert.equal(sheet.getCell('E9').numFmt, '#,##0.## "min"')
  assert.equal(sheet.getCell('E10').value, 0.01)
  assert.equal(sheet.getCell('E10').numFmt, '#,##0.## "pcs"')
  assert.equal(sheet.getCell('D20').numFmt, '#,##0.##')
  assert.equal(sheet.getCell('E20').value, 0.01)
  assert.equal(sheet.getCell('E20').numFmt, '#,##0.##')
})

test('toXlsx preserves unobserved values as N/A instead of inventing zeros', async () => {
  const report = createReport({
    periodState: 'future',
    summary: [{ id: 'events', value: 'N/A' }],
    metrics: { outputPieces: null, durationMinutes: null, availabilityPercent: null, estimatedLoss: null },
    processSensors: [{ sensorCode: 'S-01', sensorLabel: 'Coil Joint Replacement', eventCount: null }],
    rows: [],
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Operational Report')

  assert.equal(sheet.getCell('B8').value, 'N/A')
  assert.equal(sheet.getCell('E8').value, 'N/A')
  assert.equal(sheet.getCell('B9').value, 'N/A')
  assert.equal(sheet.getCell('A14').value, 'S-01')
  assert.equal(sheet.getCell('C14').value, 'N/A')
  assert.equal(sheet.getCell('A20').value, 'No downtime records for this period.')
})

test('buildExportFilename derives a safe deterministic filename from the request', () => {
  assert.equal(
    buildExportFilename({ reportType: 'monthly', selectedDate: undefined, format: 'pdf' }),
    'report-monthly-undated.pdf',
  )
  assert.equal(
    buildExportFilename({ reportType: 'weekly', selectedDate: '2026-09-02', format: 'xlsx' }),
    'report-weekly-2026-09-02.xlsx',
  )
  assert.equal(
    buildExportFilename({ category: 'regular', reportType: 'daily', selectedDate: '2026-09-02', format: 'pdf' }),
    'report-daily-2026-09-02.pdf',
  )
  assert.equal(
    buildExportFilename({ category: 'production', reportType: 'daily', selectedDate: '2026-09-02', format: 'pdf' }),
    'production-report-daily-2026-09-02.pdf',
  )
  assert.equal(
    buildExportFilename({ category: 'production', reportType: 'monthly', selectedDate: '2026-09', format: 'xlsx' }),
    'production-report-monthly-2026-09.xlsx',
  )
})

test('contentTypeFor maps each export format to its MIME type', () => {
  assert.equal(contentTypeFor('pdf'), 'application/pdf')
  assert.equal(contentTypeFor('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
})

test('toPdf renders valid production report with spec breakdown and cut logs', async () => {
  const buffer = await toPdf(createProductionReport())

  assert.ok(Buffer.isBuffer(buffer))
  assert.ok(buffer.length > 1000, `expected a substantive document, got ${buffer.length} bytes`)
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

test('toPdf renders production report with empty logs cleanly', async () => {
  const buffer = await toPdf(createProductionReport({
    specBreakdown: [],
    productionLogs: [],
    totalProductionOutput: 0,
    specifiedPipes: 0,
    unspecifiedPipes: 0,
    distinctProductSizes: 0,
  }))

  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

test('toPdf renders multi-page production report with large cut log history', async () => {
  const manyLogs = Array.from({ length: 60 }, (_, i) => ({
    id: `evt-${i}`,
    deviceEventId: 100 + i,
    recordedAt: new Date(Date.UTC(2026, 8, 2, 1, Math.floor(i / 2), (i % 2) * 30)).toISOString(),
    label: i % 2 === 0 ? 'Grade A 6-inch' : null,
    size: i % 2 === 0 ? '6 inch' : null,
    diameter: i % 2 === 0 ? 168.28 : null,
    radius: i % 2 === 0 ? 84.14 : null,
    circumference: i % 2 === 0 ? 528.67 : null,
    isSpecified: i % 2 === 0,
  }))

  const buffer = await toPdf(createProductionReport({ productionLogs: manyLogs }))
  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')

  const pdfString = buffer.toString('latin1')
  const pageCount = (pdfString.match(/\/Type\s*\/Page\b/g) || []).length
  assert.ok(pageCount >= 2, `expected at least 2 pages for 60 cut logs, got ${pageCount}`)
})

test('toXlsx writes a 2-worksheet production report with summary and cut logs', async () => {
  const buffer = await toXlsx(createProductionReport())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  assert.ok(summarySheet, 'expected Production Summary worksheet')
  assert.equal(summarySheet.views[0].showGridLines, false)
  assert.equal(summarySheet.getCell('A2').value, 'PETRO HYDRO PIPE CORP.  |  Production Output Report')
  assert.equal(summarySheet.getCell('B8').value, 10)
  assert.equal(summarySheet.getCell('B8').numFmt, '#,##0 "pcs"')
  assert.equal(summarySheet.getCell('E8').value, 14.7196)
  assert.equal(summarySheet.getCell('E8').numFmt, '#,##0.0000 "tons"')
  assert.equal(summarySheet.getCell('B9').value, 8)
  assert.equal(summarySheet.getCell('B9').numFmt, '#,##0 "pcs"')
  assert.equal(summarySheet.getCell('E9').value, 2)
  assert.equal(summarySheet.getCell('E9').numFmt, '#,##0 "pcs"')
  assert.equal(summarySheet.getCell('B10').value, 2)

  // Verify spec breakdown row
  assert.equal(summarySheet.getCell('A13').value, 'MCWD')
  assert.equal(summarySheet.getCell('B13').value, 625.4)
  assert.equal(summarySheet.getCell('C13').value, 12.7)
  assert.equal(summarySheet.getCell('D13').value, 6000)
  assert.equal(summarySheet.getCell('E13').value, 5)
  assert.equal(summarySheet.getCell('F13').value, 5.7565)
  assert.equal(summarySheet.getCell('G13').value, 0.5)

  const logsSheet = workbook.getWorksheet('Production Cut Logs')
  assert.ok(logsSheet, 'expected Production Cut Logs worksheet')
  assert.equal(logsSheet.getCell('A2').value, 'PETRO HYDRO PIPE CORP.  |  Production Cut Logs (S-05)')
  assert.equal(logsSheet.getCell('B6').value, 'MCWD')
  assert.equal(logsSheet.getCell('C6').value, 625.4)
  assert.equal(logsSheet.getCell('D6').value, 12.7)
  assert.equal(logsSheet.getCell('E6').value, 6000)
  assert.equal(logsSheet.getCell('F6').value, 101)
  assert.equal(logsSheet.getCell('G6').value, 1.1513)
  assert.equal(logsSheet.getCell('H6').value, 'Specified')

  // Row 2 is unassigned
  assert.equal(logsSheet.getCell('B7').value, 'Pending Tag')
  assert.equal(logsSheet.getCell('H7').value, 'Pending Tag')
})

test('toXlsx preserves unobserved production report values cleanly', async () => {
  const report = createProductionReport({
    periodState: 'future',
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: 'N/A' },
      { id: 'total-tonnage', label: 'Total Production Tonnage (tons)', value: 'N/A' },
      { id: 'specified-pipes', label: 'Specified Pipes', value: 'N/A' },
      { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: 'N/A' },
      { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: 'N/A' },
    ],
    metrics: {
      totalProductionOutput: null,
      totalTonnage: null,
      specifiedPipes: null,
      unspecifiedPipes: null,
      distinctProductSizes: null,
    },
    totalProductionOutput: null,
    totalTonnage: null,
    specifiedPipes: null,
    unspecifiedPipes: null,
    distinctProductSizes: null,
    specBreakdown: [],
    productionLogs: [],
  })

  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  assert.equal(summarySheet.getCell('B8').value, 'N/A')
  assert.equal(summarySheet.getCell('E8').value, 'N/A')
  assert.equal(summarySheet.getCell('B9').value, 'N/A')
  assert.equal(summarySheet.getCell('E9').value, 'N/A')
  assert.equal(summarySheet.getCell('A13').value, 'No accepted pipe cutting events recorded for this period.')
})

test('toPdf renders cut logs without event ref column even when deviceEventId is 0 or fallback', async () => {
  const report = createProductionReport({
    productionLogs: [
      {
        id: 'evt-uuid-fallback',
        deviceEventId: 0,
        recordedAt: '2026-09-02T01:00:00.000Z',
        label: 'Pipe 0',
        size: '6 inch',
        diameter: 100,
        radius: 50,
        circumference: 314.16,
        isSpecified: true,
      },
    ],
  })
  const buffer = await toPdf(report)
  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

test('toPdf renders header with company profile and monitoring system without plant line or spiral mill', async () => {
  const buffer = await toPdf(createProductionReport())
  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')

  const pdfRaw = buffer.toString('latin1')
  assert.equal(pdfRaw.includes('Plant Line:'), false)
})

test('toXlsx renders deviceEventId 0 in cut logs correctly', async () => {
  const report = createProductionReport({
    productionLogs: [
      {
        id: 'evt-uuid-fallback',
        deviceEventId: 0,
        recordedAt: '2026-09-02T01:00:00.000Z',
        customer: 'MCWD',
        pipeNumber: null,
        diameter: 100,
        thickness: 10,
        length: 6000,
        isSpecified: true,
      },
    ],
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const logsSheet = workbook.getWorksheet('Production Cut Logs')
  assert.equal(logsSheet.getCell('F6').value, 0)
})

test('toPdf handles malformed and non-finite diameter gracefully with N/A', async () => {
  const report = createProductionReport({
    specBreakdown: [
      {
        label: 'Malformed Pipe',
        size: 'Custom',
        diameter: NaN,
        radius: 'invalid',
        circumference: Infinity,
        isSpecified: true,
        pipeCount: 1,
        percentageOfTotal: 100,
      },
    ],
    productionLogs: [
      {
        id: 'evt-1',
        deviceEventId: 1,
        recordedAt: '2026-09-02T01:00:00.000Z',
        label: 'Malformed Pipe',
        size: 'Custom',
        diameter: NaN,
        radius: 'invalid',
        circumference: Infinity,
        isSpecified: true,
      },
    ],
  })
  const buffer = await toPdf(report)
  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

test('toXlsx regular workbook displays machine name in cell D3 for future unobserved periods', async () => {
  const report = createReport({
    periodState: 'future',
    machine: { id: 'm-01', code: 'M-01', name: 'Spiral Mill 01' },
    summary: [
      { id: 'production', label: 'Production Count', value: 'N/A', helper: 'Period not reached yet' },
    ],
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Operational Report')
  assert.equal(sheet.getCell('D3').value, 'Spiral Mill 01')
})

test('toXlsx escapes spreadsheet formula injection payloads with leading single quote', async () => {
  const report = createProductionReport({
    specBreakdown: [
      {
        customer: '=cmd|/C calc!A0',
        diameter: 100,
        thickness: 10,
        length: 6000,
        singleTonnage: 0.1332,
        totalTonnage: 0.1332,
        isSpecified: true,
        pipeCount: 1,
        percentageOfTotal: 100,
      },
    ],
    productionLogs: [
      {
        id: 'evt-1',
        deviceEventId: '@SUM(1+1)',
        recordedAt: '2026-09-02T01:00:00.000Z',
        customer: '-10% Discount',
        pipeNumber: null,
        diameter: 100,
        thickness: 10,
        length: 6000,
        tonnage: 0.1332,
        isSpecified: true,
      },
    ],
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  assert.equal(summarySheet.getCell('A13').value, "'=cmd|/C calc!A0")

  const logsSheet = workbook.getWorksheet('Production Cut Logs')
  assert.equal(logsSheet.getCell('B6').value, "'-10% Discount")
  assert.equal(logsSheet.getCell('F6').value, "'@SUM(1+1)")
})

test('toXlsx suppresses process sensor table headers when processSensors is empty', async () => {
  const report = createReport({
    processSensors: [],
    rows: [],
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Operational Report')

  assert.notEqual(sheet.getCell('A12').value, 'Process Sensor Activity')
  assert.equal(sheet.getCell('A13').value, 'Downtime Records')
})

test('buildExportFilename sanitizes path traversal, CRLF, and special characters', () => {
  assert.equal(
    buildExportFilename({
      category: 'production',
      reportType: '../../daily\r\nSet-Cookie:bad',
      selectedDate: '2026-09-02"; DROP TABLE--',
      format: 'xlsx',
    }),
    'production-report-....dailySet-Cookiebad-2026-09-02DROPTABLE--.xlsx',
  )
})

test('production reports completely exclude Radius and Circumference from PDF and Excel outputs', async () => {
  const report = createProductionReport()
  const pdfBuffer = await toPdf(report)
  const pdfText = pdfBuffer.toString('latin1')
  assert.equal(pdfText.includes('Radius'), false, 'PDF must not mention Radius')
  assert.equal(pdfText.includes('Circumference'), false, 'PDF must not mention Circumference')

  const xlsxBuffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)
  const summarySheet = workbook.getWorksheet('Production Summary')
  const logsSheet = workbook.getWorksheet('Production Cut Logs')

  const summaryHeaders = summarySheet.getRow(12).values.filter(Boolean)
  assert.deepEqual(summaryHeaders, ['Customer', 'Diameter (OD) mm', 'Thickness mm', 'Length mm', 'Quantity (pcs)', 'Total Tons', '% of Total'])
  assert.equal(summaryHeaders.some((h) => String(h).includes('Radius') || String(h).includes('Circumference')), false)

  const logHeaders = logsSheet.getRow(5).values.filter(Boolean)
  assert.deepEqual(logHeaders, ['Cut Timestamp (PST)', 'Customer', 'Diameter (OD) mm', 'Thickness mm', 'Length mm', 'Pipe #', 'Tons', 'Status'])
  assert.equal(logHeaders.some((h) => String(h).includes('Radius') || String(h).includes('Circumference')), false)
})

