const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const ExcelJS = require('@excel.js/exceljs').default
const { assertError, loadAppWithMocks, requestJson, withTestServer } = require('../../helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const USER_ID = '22222222-2222-4222-8222-222222222222'

function authHeader(role) {
  const token = jwt.sign({ username: 'reports-export-user', role }, JWT_SECRET, {
    subject: USER_ID,
    expiresIn: '1h',
  })
  return { Authorization: `Bearer ${token}` }
}

const REPORT = {
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
    { cause: 'Corrective Maintenance', sensor: 'S-01 Coil Joint Replacement', events: 2, durationMinutes: 45, estimatedLoss: 3 },
  ],
}

function loadExportApp({ summaryCalls, auditCalls }) {
  return loadAppWithMocks({
    'src/modules/reports/reports.service.js': {
      getSummary: async (query) => {
        summaryCalls.push(query)
        if (query.category === 'production') {
          return {
            category: 'production',
            generatedAt: '2026-09-03T01:23:45.678Z',
            reportType: query.type || 'daily',
            selectedDate: query.date || '2026-09-02',
            periodState: 'complete',
            observedStartAt: '2026-09-01T16:00:00.000Z',
            observedEndAt: '2026-09-02T16:00:00.000Z',
            machine: { id: 'm-1', code: 'M-01', name: 'Spiral Mill 01' },
            sensor: { id: 's-5', code: 'S-05', label: 'S-05 Cutting Sensor' },
            summary: [
              { id: 'total-output', label: 'Total Production Output', value: '10 pcs', helper: 'From Spiral Mill 01' },
            ],
            metrics: {
              totalProductionOutput: 10,
              specifiedPipes: 8,
              unspecifiedPipes: 2,
              distinctProductSizes: 2,
            },
            totalProductionOutput: 10,
            specifiedPipes: 8,
            unspecifiedPipes: 2,
            distinctProductSizes: 2,
            specBreakdown: [
              {
                label: 'Grade A 6-inch',
                size: '6 inch',
                diameter: 168.28,
                radius: 84.14,
                circumference: 528.67,
                isSpecified: true,
                pipeCount: 8,
                percentageOfTotal: 80.0,
                firstCutAt: '2026-09-02T01:00:00.000Z',
                lastCutAt: '2026-09-02T03:00:00.000Z',
              },
            ],
            productionLogs: [
              {
                id: 'evt-1',
                deviceEventId: 101,
                recordedAt: '2026-09-02T01:00:00.000Z',
                label: 'Grade A 6-inch',
                size: '6 inch',
                diameter: 168.28,
                radius: 84.14,
                circumference: 528.67,
                isSpecified: true,
              },
              {
                id: 'evt-2',
                deviceEventId: 102,
                recordedAt: '2026-09-02T02:00:00.000Z',
                label: null,
                size: null,
                diameter: null,
                radius: null,
                circumference: null,
                isSpecified: false,
              },
            ],
            rows: [],
          }
        }
        return { ...REPORT, rows: [...REPORT.rows] }
      },
    },
    'src/modules/audit/audit.service.js': {
      listAuditLogs: async () => ({}),
      recordAuditLog: async (entry) => {
        auditCalls.push(entry)
      },
    },
  })
}

async function requestExport(baseUrl, body, headers) {
  const response = await fetch(`${baseUrl}/api/reports/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  })

  return response
}

test('Export API enforces authentication, report export roles, and request validation', async () => {
  const app = loadExportApp({ summaryCalls: [], auditCalls: [] })

  await withTestServer(app, async (baseUrl) => {
    const body = { type: 'daily', date: '2026-09-02', format: 'xlsx' }

    assert.equal((await requestExport(baseUrl, body)).status, 401)

    // Admin, Operation Manager, and Quality Control can export reports.
    assert.equal((await requestExport(baseUrl, body, authHeader('Production Supervisor'))).status, 403)
    assert.equal((await requestExport(baseUrl, body, authHeader('Engineering Supervisor'))).status, 403)
    assert.equal((await requestExport(baseUrl, body, authHeader('Managing Director'))).status, 403)
    assert.equal((await requestExport(baseUrl, body, authHeader('Quality Control'))).status, 200)

    // View access to the summary endpoint is intentionally unchanged.
    const summary = await requestJson(baseUrl, '/api/reports/summary?type=daily', {
      headers: authHeader('Quality Control'),
    })
    assert.equal(summary.response.status, 200)

    for (const invalid of [
      { type: 'daily', format: 'xls' },
      { type: 'yearly', format: 'pdf' },
      { type: 'daily', date: '09-02-2026', format: 'xlsx' },
    ]) {
      const response = await requestExport(baseUrl, invalid, authHeader('Admin'))
      assert.equal(response.status, 400, JSON.stringify(invalid))
      const payload = await response.json()
      assertError(payload, 'VALIDATION_ERROR')
    }
  })
})

test('Export API streams PDF for Admin and Operation Manager', async () => {
  const auditCalls = []
  const app = loadExportApp({ summaryCalls: [], auditCalls })

  await withTestServer(app, async (baseUrl) => {
    for (const role of ['Admin', 'Operation Manager']) {
      const response = await requestExport(
        baseUrl,
        { type: 'weekly', format: 'pdf' },
        authHeader(role),
      )

      assert.equal(response.status, 200, role)
      assert.equal(response.headers.get('content-type'), 'application/pdf')
      assert.ok(response.headers.get('content-disposition').includes('.pdf"'))

      const buffer = Buffer.from(await response.arrayBuffer())
      assert.equal(buffer.subarray(0, 5).toString('utf8'), '%PDF-')
    }

    assert.equal(auditCalls.length, 2)
    assert.ok(auditCalls.every((entry) => entry.action === 'REPORT_EXPORTED' && entry.metadata.format === 'pdf'))
  })
})

test('Export API streams a formatted XLSX workbook and records its format in the audit entry', async () => {
  const auditCalls = []
  const app = loadExportApp({ summaryCalls: [], auditCalls })

  await withTestServer(app, async (baseUrl) => {
    const response = await requestExport(
      baseUrl,
      { type: 'daily', date: '2026-09-02', format: 'xlsx' },
      authHeader('Admin'),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="report-daily-2026-09-02.xlsx"')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
    const sheet = workbook.getWorksheet('Operational Report')
    assert.equal(sheet.getCell('A20').value, 'Corrective Maintenance')
    assert.equal(sheet.getCell('B8').value, 1250)

    assert.equal(auditCalls.length, 1)
    assert.equal(auditCalls[0].action, 'REPORT_EXPORTED')
    assert.equal(auditCalls[0].metadata.format, 'xlsx')
    assert.equal(auditCalls[0].metadata.reportCategory, 'regular')
  })
})

test('Export API exports production report with category parameter and production filename', async () => {
  const summaryCalls = []
  const auditCalls = []
  const app = loadExportApp({ summaryCalls, auditCalls })

  await withTestServer(app, async (baseUrl) => {
    // 1. Export Production PDF
    const pdfResponse = await requestExport(
      baseUrl,
      { category: 'production', type: 'daily', date: '2026-09-02', format: 'pdf' },
      authHeader('Admin'),
    )

    assert.equal(pdfResponse.status, 200)
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf')
    assert.equal(pdfResponse.headers.get('content-disposition'), 'attachment; filename="production-report-daily-2026-09-02.pdf"')

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())
    assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-')

    // 2. Export Production XLSX
    const xlsxResponse = await requestExport(
      baseUrl,
      { category: 'production', type: 'weekly', date: '2026-09-02', format: 'xlsx' },
      authHeader('Operation Manager'),
    )

    assert.equal(xlsxResponse.status, 200)
    assert.equal(xlsxResponse.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.equal(xlsxResponse.headers.get('content-disposition'), 'attachment; filename="production-report-weekly-2026-09-02.xlsx"')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await xlsxResponse.arrayBuffer()))
    const summarySheet = workbook.getWorksheet('Production Summary')
    assert.ok(summarySheet)
    assert.equal(summarySheet.getCell('B8').value, 10)

    // Verify summary calls received category: 'production'
    assert.equal(summaryCalls[0].category, 'production')
    assert.equal(summaryCalls[1].category, 'production')

    // Verify audit logs record reportCategory: 'production' and rowCount from productionLogs
    assert.equal(auditCalls.length, 2)
    assert.equal(auditCalls[0].metadata.reportCategory, 'production')
    assert.equal(auditCalls[0].metadata.rowCount, 2)
    assert.equal(auditCalls[1].metadata.reportCategory, 'production')
    assert.equal(auditCalls[1].metadata.rowCount, 2)
  })
})

test('Export API limits repeated exports per user beyond the configured cap', async () => {
  const app = loadExportApp({ summaryCalls: [], auditCalls: [] })

  await withTestServer(app, async (baseUrl) => {
    const requests = await Promise.all(Array.from({ length: 11 }, () => requestExport(
      baseUrl,
      { type: 'daily', format: 'xlsx' },
      authHeader('Admin'),
    )))
    const limited = requests.filter((response) => response.status === 429)

    assert.equal(limited.length, 1)
    const payload = await limited[0].json()
    assertError(payload, 'RATE_LIMITED')
    assert.ok(limited[0].headers.get('retry-after'))
  })
})
