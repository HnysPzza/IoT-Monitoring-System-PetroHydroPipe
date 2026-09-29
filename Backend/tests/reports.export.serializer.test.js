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
})

test('contentTypeFor maps each export format to its MIME type', () => {
  assert.equal(contentTypeFor('pdf'), 'application/pdf')
  assert.equal(contentTypeFor('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
})
