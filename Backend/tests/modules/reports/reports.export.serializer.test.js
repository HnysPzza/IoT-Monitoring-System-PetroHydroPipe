const assert = require('node:assert/strict')
const test = require('node:test')
const zlib = require('node:zlib')
const ExcelJS = require('@excel.js/exceljs').default
const { toXlsx } = require('../../../src/modules/reports/reportsXlsx.serializer')

const {
  buildExportFilename,
  contentTypeFor,
  toPdf,
} = require('../../../src/modules/reports/reportsExport.serializer')

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

function cellResult(cell) {
  return cell.result ?? cell.value
}

test('toXlsx writes a styled minimal slate report with typed values, formulas, and WCAG palette', async () => {
  const buffer = await toXlsx(createReport())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Operational Report')

  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(sheet.views[0].showGridLines, false)
  assert.equal(sheet.getCell('A1').value, 'Petro Hydro Pipes Corporation  ·  Operational Report')
  assert.equal(sheet.getCell('A1').font.size, 14)
  assert.ok(sheet.getCell('A2').value.includes('Sep 2, 2026'))
  assert.ok(sheet.getCell('D2').value.includes('PST'))
  assert.equal(sheet.getCell('A5').value, 1250)
  assert.equal(sheet.getCell('A5').numFmt, '[=1]#,##0 "pc";#,##0 "pcs"')
  assert.equal(sheet.getCell('B5').value, 0.9074)
  assert.equal(sheet.getCell('B5').numFmt, '0.0%')
  assert.equal(sheet.getCell('C5').value, 2)
  assert.equal(sheet.getCell('D5').numFmt, '#,##0 "min"')
  assert.equal(sheet.getCell('E5').numFmt, '#,##0 "pcs"')

  // Process Sensor Activity (Row 7 title, Row 8 header, Row 9 S-01, Row 10 Total)
  assert.equal(sheet.getCell('A7').value, 'Process Sensor Activity')
  assert.equal(sheet.getCell('A9').value, 'S-01')
  assert.equal(cellResult(sheet.getCell('C10')), 2)
  assert.equal(sheet.getCell('C10').formula, 'SUM(C9:C9)')

  // Downtime Records (Row 12 title, Row 13 header, Row 14..15 rows, Row 16 Total)
  assert.equal(sheet.getCell('A12').value, 'Downtime Records')
  assert.equal(sheet.autoFilter, 'A13:E15')
  assert.equal(sheet.getCell('A14').value, 'Corrective Maintenance')
  assert.equal(sheet.getCell('C14').value, 2)
  assert.equal(sheet.getCell('D14').numFmt, '#,##0')
  assert.equal(sheet.getCell('E14').value, 3)
  assert.equal(sheet.getCell('E14').numFmt, '#,##0.00')
  assert.equal(sheet.getCell('E15').numFmt, '#,##0.00')
  assert.equal(sheet.getCell('A16').value, 'TOTAL ATTRIBUTED DOWNTIME')
  assert.equal(sheet.getCell('C16').formula, 'SUM(C14:C15)')
  assert.equal(cellResult(sheet.getCell('C16')), 3)
  assert.equal(sheet.getCell('D16').formula, 'SUM(D14:D15)')
  assert.equal(cellResult(sheet.getCell('D16')), 55)
  assert.equal(sheet.getCell('E16').formula, 'SUM(E14:E15)')
  assert.equal(cellResult(sheet.getCell('E16')), 3.5)
  assert.equal(sheet.getCell('A13').font.color.argb, 'FF475569')

  const colors = new Set()
  const nonArialCells = []
  sheet.eachRow((row) => row.eachCell((cell) => {
    if (cell.value !== null && cell.value !== undefined && cell.value !== '' && cell.font?.name !== 'Arial') {
      nonArialCells.push(cell.address)
    }
    if (cell.font?.color?.argb) colors.add(cell.font.color.argb)
    if (cell.fill?.fgColor?.argb) colors.add(cell.fill.fgColor.argb)
    for (const side of Object.values(cell.border || {})) {
      if (side.color?.argb) colors.add(side.color.argb)
    }
  }))
  assert.deepEqual(nonArialCells, [])
  assert.equal(colors.has('FFE4E9EF'), false)
  assert.equal(colors.has('FF1F3A5F'), false)
  assert.ok(colors.has('FF0F172A'))
  assert.ok(colors.has('FFF8FAFC'))
  assert.ok(sheet.pageSetup.horizontalCentered)
  assert.ok(sheet.headerFooter?.oddFooter?.includes('Page &P of &N'))
  assert.ok(sheet.headerFooter?.oddFooter?.includes('Spiral Mill 01'))
  assert.equal(sheet.headerFooter?.oddFooter?.includes('undefined'), false)
})

test('toXlsx keeps small fractional durations and losses visible with fixed loss alignment', async () => {
  const report = createReport({
    metrics: { ...createReport().metrics, durationMinutes: 0.01, estimatedLoss: 0.01 },
    rows: [{ ...createReport().rows[0], durationMinutes: 0.01, estimatedLoss: 0.01 }],
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Operational Report')

  assert.equal(sheet.getCell('D5').value, 0.01)
  assert.equal(sheet.getCell('D5').numFmt, '#,##0.## "min"')
  assert.equal(sheet.getCell('E5').value, 0.01)
  assert.equal(sheet.getCell('E5').numFmt, '#,##0.## "pcs"')
  assert.equal(sheet.getCell('D14').numFmt, '#,##0.##')
  assert.equal(sheet.getCell('E14').value, 0.01)
  assert.equal(sheet.getCell('E14').numFmt, '#,##0.00')
})

test('toXlsx preserves unobserved values as muted em-dash instead of inventing zeros', async () => {
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

  assert.equal(sheet.getCell('A5').value, '—')
  assert.equal(sheet.getCell('C5').value, '—')
  assert.equal(sheet.getCell('D5').value, '—')
  assert.equal(sheet.getCell('E5').value, '—')
  assert.equal(sheet.getCell('A9').value, 'S-01')
  assert.equal(sheet.getCell('C9').value, '—')
  assert.equal(sheet.getCell('C9').font.color.argb, 'FF64748B')
  assert.equal(sheet.getCell('C10').value, '—')
  assert.equal(sheet.getCell('C10').font.color.argb, 'FF64748B')
  assert.equal(sheet.getCell('A14').value, 'No downtime records for this period.')
})

test('buildExportFilename derives a safe deterministic filename from the request', () => {
  assert.equal(
    buildExportFilename({ reportType: 'monthly', selectedDate: undefined, format: 'pdf' }),
    'Operational-MonthlyReport-undated.pdf',
  )
  assert.equal(
    buildExportFilename({ reportType: 'weekly', selectedDate: '2026-09-02', format: 'xlsx' }),
    'Operational-WeeklyReport-2026-09-02.xlsx',
  )
  assert.equal(
    buildExportFilename({ category: 'regular', reportType: 'daily', selectedDate: '2026-09-02', format: 'pdf' }),
    'Operational-DailyReport-2026-09-02.pdf',
  )
  assert.equal(
    buildExportFilename({ category: 'production', reportType: 'daily', selectedDate: '2026-11-16', format: 'xlsx' }),
    'Production-DailyReport-2026-11-16.xlsx',
  )
  assert.equal(
    buildExportFilename({ category: 'production', reportType: 'monthly', selectedDate: '2026-09', format: 'xlsx' }),
    'Production-MonthlyReport-2026-09.xlsx',
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

test('toXlsx writes a 2-worksheet production report with KPI strip, formulas, sortable cut logs, and daily rollup', async () => {
  const buffer = await toXlsx(createProductionReport())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const summarySheet = workbook.getWorksheet('Production Summary')
  assert.ok(summarySheet, 'expected Production Summary worksheet')
  assert.equal(summarySheet.views[0].showGridLines, false)
  assert.equal(summarySheet.getCell('A1').value, 'Petro Hydro Pipes Corporation  ·  Production Output Report')
  assert.equal(summarySheet.getCell('A5').value, 10)
  assert.equal(summarySheet.getCell('A5').numFmt, '[=1]#,##0 "pc";#,##0 "pcs"')
  assert.equal(summarySheet.getCell('B5').value, 14.7196)
  assert.equal(summarySheet.getCell('B5').numFmt, '#,##0.0000')
  assert.equal(summarySheet.getCell('C5').value, 8)
  assert.equal(summarySheet.getCell('C5').numFmt, '[=1]#,##0 "pc";#,##0 "pcs"')
  assert.equal(summarySheet.getCell('D5').value, 2)
  assert.equal(summarySheet.getCell('D5').numFmt, '[=1]#,##0 "pc";#,##0 "pcs"')
  assert.equal(summarySheet.getCell('E5').formula, 'IF(A5>0,C5/A5,0)')
  assert.equal(cellResult(summarySheet.getCell('E5')), 0.8)
  assert.equal(summarySheet.getCell('E5').numFmt, '0.0%')
  assert.equal(summarySheet.getCell('F5').value, 2)
  assert.equal(summarySheet.getCell('G5').value, 'Complete')

  // Verify spec breakdown row 9..11 and Total Row 12
  assert.equal(summarySheet.autoFilter, 'A8:G11')
  assert.equal(summarySheet.getCell('A9').value, 'MCWD')
  assert.equal(summarySheet.getCell('B9').value, 625.4)
  assert.equal(summarySheet.getCell('C9').value, 12.7)
  assert.equal(summarySheet.getCell('D9').value, 6000)
  assert.equal(summarySheet.getCell('E9').value, 5)
  assert.equal(summarySheet.getCell('F9').value, 5.7565)
  assert.equal(summarySheet.getCell('G9').formula, 'IF($E$12>0,E9/$E$12,0)')
  assert.equal(cellResult(summarySheet.getCell('G9')), 0.5)
  assert.equal(summarySheet.getCell('A12').value, 'TOTAL ACCEPTED OUTPUT')
  assert.equal(summarySheet.getCell('E12').formula, 'SUM(E9:E11)')
  assert.equal(cellResult(summarySheet.getCell('E12')), 10)
  assert.equal(summarySheet.getCell('F12').formula, 'SUM(F9:F11)')
  assert.equal(cellResult(summarySheet.getCell('F12')), 14.7196)
  assert.equal(summarySheet.getCell('G12').formula, 'SUM(G9:G11)')
  assert.equal(cellResult(summarySheet.getCell('G12')), 1)

  const logsSheet = workbook.getWorksheet('Production Cut Logs')
  assert.ok(logsSheet, 'expected Production Cut Logs worksheet')
  assert.equal(logsSheet.getCell('A1').value, 'Petro Hydro Pipes Corporation  ·  Production Cut Logs (S-05)')
  assert.equal(logsSheet.views[0].ySplit, 4)
  assert.equal(logsSheet.autoFilter, 'A4:H6')
  assert.equal(logsSheet.pageSetup.printTitlesRow, '4:4')
  assert.ok(logsSheet.getCell('A5').value instanceof Date)
  assert.equal(logsSheet.getCell('B5').value, 'MCWD')
  assert.equal(logsSheet.getCell('C5').value, 625.4)
  assert.equal(logsSheet.getCell('D5').value, 12.7)
  assert.equal(logsSheet.getCell('E5').value, 6000)
  assert.equal(logsSheet.getCell('F5').value, 101)
  assert.equal(logsSheet.getCell('G5').value, 1.1513)
  assert.equal(logsSheet.getCell('H5').value, 'Specified')

  // Row 6 is unassigned (row 2 of cut logs)
  assert.equal(logsSheet.getCell('B6').value, 'Pending Tag')
  assert.equal(logsSheet.getCell('H6').value, 'Pending Tag')
  assert.equal(logsSheet.getCell('A7').value, 'TOTAL (VISIBLE CUTS)')
  assert.equal(logsSheet.getCell('F7').formula, 'SUBTOTAL(3,A5:A6)')
  assert.equal(cellResult(logsSheet.getCell('F7')), 2)
  assert.equal(logsSheet.getCell('G7').formula, 'SUBTOTAL(9,G5:G6)')
  assert.equal(cellResult(logsSheet.getCell('G7')), 1.1513)
})

test('toXlsx preserves exact sub-percent Tag Coverage precision without whole-percent rounding', async () => {
  const report = createProductionReport({
    metrics: {
      totalProductionOutput: 3,
      totalTonnage: 2.3026,
      specifiedPipes: 2,
      unspecifiedPipes: 1,
      distinctProductSizes: 1,
    },
  })
  const buffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const summarySheet = workbook.getWorksheet('Production Summary')

  assert.equal(summarySheet.getCell('E5').formula, 'IF(A5>0,C5/A5,0)')
  assert.ok(Math.abs(cellResult(summarySheet.getCell('E5')) - (2 / 3)) < 1e-9)
})

test('toXlsx preserves unobserved production report values as muted em-dash cleanly', async () => {
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
  assert.equal(summarySheet.getCell('A5').value, '—')
  assert.equal(summarySheet.getCell('B5').value, '—')
  assert.equal(summarySheet.getCell('C5').value, '—')
  assert.equal(summarySheet.getCell('D5').value, '—')
  assert.equal(summarySheet.getCell('E5').value, '—')
  assert.equal(summarySheet.getCell('A9').value, 'No accepted pipe cutting events recorded for this period.')
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
  assert.equal(logsSheet.getCell('F5').value, 0)
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

test('toXlsx regular workbook displays machine name in context banner for future unobserved periods', async () => {
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
  assert.ok(String(sheet.getCell('A2').value).includes('Spiral Mill 01'))
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
  assert.equal(summarySheet.getCell('A9').value, "'=cmd|/C calc!A0")

  const logsSheet = workbook.getWorksheet('Production Cut Logs')
  assert.equal(logsSheet.getCell('B5').value, "'-10% Discount")
  assert.equal(logsSheet.getCell('F5').value, "'@SUM(1+1)")
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

  assert.notEqual(sheet.getCell('A7').value, 'Process Sensor Activity')
  assert.equal(sheet.getCell('A7').value, 'Downtime Records')
})

test('buildExportFilename sanitizes path traversal, CRLF, and special characters', () => {
  assert.equal(
    buildExportFilename({
      category: 'production',
      reportType: '../../daily\r\nSet-Cookie:bad',
      selectedDate: '2026-09-02"; DROP TABLE--',
      format: 'xlsx',
    }),
    'Production-DailySet-CookiebadReport-2026-09-02DROPTABLE--.xlsx',
  )
  assert.equal(
    buildExportFilename({
      category: 'production',
      reportType: 'daily',
      selectedDate: '../..//',
      format: 'xlsx',
    }),
    'Production-DailyReport-undated.xlsx',
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

  const summaryHeaders = summarySheet.getRow(8).values.filter(Boolean)
  assert.deepEqual(summaryHeaders, ['Customer', 'Diameter (OD) mm', 'Thickness mm', 'Length mm', 'Quantity (pcs)', 'Total Tons', '% of Total'])
  assert.equal(summaryHeaders.some((h) => String(h).includes('Radius') || String(h).includes('Circumference')), false)

  const logHeaders = logsSheet.getRow(4).values.filter(Boolean)
  assert.deepEqual(logHeaders, ['Cut Timestamp (PST)', 'Customer', 'Diameter (OD) mm', 'Thickness mm', 'Length mm', 'Pipe #', 'Tons', 'Status'])
  assert.equal(logHeaders.some((h) => String(h).includes('Radius') || String(h).includes('Circumference')), false)
})

test('production export keeps Cut Logs pure/sortable and moves Manila daily totals to Summary COUNTIFS/SUMIFS rollup', async () => {
  const report = createProductionReport({
    reportType: 'weekly',
    selectedDate: '2026-09-01',
    productionLogs: [
      {
        id: 'evt-d1-1',
        deviceEventId: 1,
        recordedAt: '2026-09-01T01:00:00.000Z', // 2026-09-01 09:00 PST
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 1,
        tonnage: 1.1514,
        isSpecified: true,
      },
      {
        id: 'evt-d1-2',
        deviceEventId: 2,
        recordedAt: '2026-09-01T15:30:00.000Z', // 2026-09-01 23:30 PST (same Manila day)
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 2,
        tonnage: 1.1514,
        isSpecified: true,
      },
      {
        id: 'evt-d2-1',
        deviceEventId: 3,
        recordedAt: '2026-09-01T16:30:00.000Z', // 2026-09-02 00:30 PST (next Manila day)
        customer: 'Regan',
        diameter: 1020,
        thickness: 10,
        length: 12000,
        pipeNumber: 1,
        tonnage: 2.989,
        isSpecified: true,
      },
    ],
  })

  const xlsxBuffer = await toXlsx(report)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsxBuffer)
  const summarySheet = workbook.getWorksheet('Production Summary')
  const logsSheet = workbook.getWorksheet('Production Cut Logs')

  // Cut Logs stays strictly chronological/filterable: Rows 5..7 data, Row 8 live SUBTOTAL footer
  assert.equal(logsSheet.getCell('F5').value, 1)
  assert.equal(logsSheet.getCell('F6').value, 2)
  assert.equal(logsSheet.getCell('F7').value, 1)
  assert.equal(logsSheet.getCell('A8').value, 'TOTAL (VISIBLE CUTS)')
  assert.equal(logsSheet.getCell('F8').formula, 'SUBTOTAL(3,A5:A7)')
  assert.equal(cellResult(logsSheet.getCell('F8')), 3)
  assert.equal(logsSheet.getCell('G8').formula, 'SUBTOTAL(9,G5:G7)')
  assert.equal(cellResult(logsSheet.getCell('G8')), 5.2918)

  // Daily Production Rollup starts cleanly below Spec Breakdown Total (Row 12):
  // Row 13 spacer, Row 14 title, Row 15 headers, Row 16 (2026-09-01), Row 17 (2026-09-02), Row 18 total
  assert.equal(summarySheet.getCell('A14').value, 'Daily Production Rollup (Manila PST)')
  assert.ok(summarySheet.getCell('A16').value instanceof Date)
  assert.equal(summarySheet.getCell('A16').value.toISOString().slice(0, 10), '2026-09-01')
  assert.ok(summarySheet.getCell('B16').formula.startsWith("COUNTIFS('Production Cut Logs'!"))
  assert.equal(cellResult(summarySheet.getCell('B16')), 2)
  assert.equal(summarySheet.getCell('B16').numFmt, '[=1]#,##0 "pc";#,##0 "pcs"')
  assert.ok(summarySheet.getCell('C16').formula.startsWith("SUMIFS('Production Cut Logs'!"))
  assert.equal(cellResult(summarySheet.getCell('C16')), 2.3028)
  assert.equal(summarySheet.getCell('C16').numFmt, '#,##0.0000')

  assert.ok(summarySheet.getCell('A17').value instanceof Date)
  assert.equal(summarySheet.getCell('A17').value.toISOString().slice(0, 10), '2026-09-02')
  assert.equal(cellResult(summarySheet.getCell('B17')), 1)
  assert.equal(cellResult(summarySheet.getCell('C17')), 2.989)
  assert.equal(summarySheet.getCell('A18').value, 'TOTAL LOGGED CUTS')
  assert.equal(cellResult(summarySheet.getCell('B18')), 3)
  assert.equal(cellResult(summarySheet.getCell('C18')), 5.2918)

  const pdfBuffer = await toPdf(report)
  assert.ok(Buffer.isBuffer(pdfBuffer))
  assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-')
})

test('toXlsx dynamically expands row height for long wrapped Customer and Cause labels', async () => {
  const longCause = 'Corrective Maintenance — Coil Joint Misalignment & Extended Re-threading Procedure Across Line'
  const regWb = new ExcelJS.Workbook()
  await regWb.xlsx.load(await toXlsx(createReport({
    rows: [{ cause: longCause, sensor: 'S-01 Raw Material & Coil Joint', events: 1, durationMinutes: 15, estimatedLoss: 0.75 }],
  })))
  const regSheet = regWb.getWorksheet('Operational Report')
  assert.ok(regSheet.getRow(14).height > 22, `Expected wrapped height > 22pt, got ${regSheet.getRow(14).height}`)
  assert.equal(regSheet.getCell('D2').alignment.wrapText, true)
  assert.ok(regSheet.getRow(2).height > 20, `Expected stacked Row 2 masthead height > 20pt, got ${regSheet.getRow(2).height}`)
})

test('toXlsx treats blank pipeNumber string as missing rather than inventing zero', async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await toXlsx(createProductionReport({
    productionLogs: [
      {
        id: 'log-blank-pipe',
        deviceEventId: 42,
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: '   ',
        tonnage: 1.1513,
        isSpecified: true,
        recordedAt: '2026-09-02T01:00:00.000Z',
      },
    ],
  })))
  const logsSheet = wb.getWorksheet('Production Cut Logs')
  assert.equal(logsSheet.getCell('F5').value, 42)
})

test('toPdf serializes a 5,000-cut production report without per-row Intl churn', async () => {
  const logs = Array.from({ length: 5000 }, (_, i) => ({
    id: `ev-${i}`,
    deviceEventId: i + 1,
    recordedAt: new Date(Date.UTC(2026, 8, 1 + (i % 28), 8 + (i % 8), i % 60)).toISOString(),
    customer: `Customer ${(i % 12) + 1}`,
    diameter: 600 + (i % 5) * 100,
    thickness: 8.5,
    length: 12000,
    pipeNumber: i + 1,
    tonnage: 1.5432,
    isSpecified: i % 3 !== 0,
  }))
  const report = createProductionReport({
    reportType: 'monthly',
    totalProductionOutput: 5000,
    totalTonnage: 7716,
    metrics: {
      totalProductionOutput: 5000,
      totalTonnage: 7716,
      specifiedPipes: 3333,
      unspecifiedPipes: 1667,
      distinctProductSizes: 5,
    },
    productionLogs: logs,
  })
  const t0 = performance.now()
  const pdfBuffer = await toPdf(report)
  const elapsedMs = performance.now() - t0
  assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-')
  assert.ok(elapsedMs < 15000, `Expected 5,000-row PDF generation < 15000ms, got ${elapsedMs.toFixed(1)}ms`)
})

function extractPdfTextBlocks(pdfBuffer) {
  const blocks = []
  let idx = 0
  while ((idx = pdfBuffer.indexOf('stream\n', idx)) !== -1) {
    const end = pdfBuffer.indexOf('\nendstream', idx)
    if (end === -1) break
    let text
    try {
      text = zlib.inflateSync(pdfBuffer.subarray(idx + 7, end)).toString('latin1')
    } catch {
      text = pdfBuffer.subarray(idx + 7, end).toString('latin1')
    }
    for (const block of text.matchAll(/BT[\s\S]*?ET/g)) {
      const tm = block[0].match(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/)
      const tj = block[0].match(/\[([^\]]+)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/)
      if (!tm || !tj) continue
      const line = tj[2]
        ? Buffer.from(tj[2], 'hex').toString('latin1')
        : [...tj[1].matchAll(/<([0-9a-fA-F]+)>/g)]
          .map((part) => Buffer.from(part[1], 'hex').toString('latin1'))
          .join('')
      if (line) blocks.push({ x: Number(tm[1]), y: Number(tm[2]), text: line })
    }
    idx = end + 10
  }
  return blocks
}

test('toPdf expands row height when wide uppercase cells wrap past actual Helvetica column width', async () => {
  const report = createProductionReport({
    specBreakdown: [
      {
        customer: 'PETRO HYDRO PIPES CORP',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeCount: 1,
        totalTonnage: 1.1513,
        percentageOfTotal: 50,
        isSpecified: true,
      },
      {
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeCount: 1,
        totalTonnage: 1.1513,
        percentageOfTotal: 50,
        isSpecified: true,
      },
    ],
    productionLogs: [],
  })

  const pdfBuffer = await toPdf(report)
  const blocks = extractPdfTextBlocks(pdfBuffer)
  const firstRow = blocks.find((b) => b.text.includes('PETRO HYDRO') && b.x < 60)
  const secondRow = blocks.find((b) => b.text.trim() === 'MCWD' && b.x < 60)

  assert.ok(firstRow, 'Expected wrapped customer row in PDF')
  assert.ok(secondRow, 'Expected following spec row in PDF')
  // Wrapped 2-line row must expand beyond the 18pt single-line height so line 2 does not hit the row border.
  assert.ok(
    firstRow.y - secondRow.y > 22,
    `Expected wrapped row height > 22pt, got ${(firstRow.y - secondRow.y).toFixed(2)}pt`,
  )
})

