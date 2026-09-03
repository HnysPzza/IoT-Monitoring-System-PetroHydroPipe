const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildExportFilename,
  contentTypeFor,
  toCsv,
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
      { id: 'loss', label: 'Estimated Loss', value: '3 pcs', helper: 'Using 0.05 pcs per downtime minute' },
    ],
    metrics: {
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

test('toCsv renders metadata block, header row, and one quoted line per downtime row', () => {
  const csv = toCsv(createReport())
  const lines = csv.split('\n')

  assert.equal(lines[0], '"Generated At","2026-09-03T01:23:45.678Z"')
  assert.equal(lines[1], '"Loss Rate Source","configured-fallback"')
  assert.equal(lines[2], '"Loss Rate Pieces Per Minute","0.05"')
  assert.equal(lines[3], '')
  assert.equal(lines[4], '"Cause","Sensor","Events","Duration Minutes","Estimated Loss"')
  assert.equal(
    lines[5],
    '"Corrective Maintenance","S-01 Coil Joint Replacement","2","45","3"',
  )
  assert.equal(lines.length, 7)
})

test('toCsv doubles embedded quotes so injected characters cannot break the cell', () => {
  const csv = toCsv(createReport())

  assert.ok(csv.includes('"Pending ""Review"", unresolved"'))
})

test('toCsv still emits the header when the report has no downtime rows', () => {
  const csv = toCsv(createReport({ rows: [] }))
  const lines = csv.split('\n')

  assert.equal(lines[4], '"Cause","Sensor","Events","Duration Minutes","Estimated Loss"')
  assert.equal(lines.length, 5)
})

test('toCsv falls back to Not available for missing metadata values', () => {
  const csv = toCsv(createReport({
    generatedAt: null,
    lossEstimateBasis: { source: null, ratePiecesPerMinute: null },
  }))

  assert.ok(csv.includes('"Generated At","Not available"'))
  assert.ok(csv.includes('"Loss Rate Source","Not available"'))
  assert.ok(csv.includes('"Loss Rate Pieces Per Minute","Not available"'))
})

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

test('buildExportFilename derives a safe deterministic filename from the request', () => {
  assert.equal(
    buildExportFilename({ reportType: 'daily', selectedDate: '2026-09-02', format: 'csv' }),
    'report-daily-2026-09-02.csv',
  )
  assert.equal(
    buildExportFilename({ reportType: 'monthly', selectedDate: undefined, format: 'pdf' }),
    'report-monthly-undated.pdf',
  )
})

test('contentTypeFor maps each export format to its MIME type', () => {
  assert.equal(contentTypeFor('csv'), 'text/csv; charset=utf-8')
  assert.equal(contentTypeFor('pdf'), 'application/pdf')
})

