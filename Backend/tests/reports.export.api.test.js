const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { assertError, loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

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

test('Export API enforces authentication, docx export roles, and request validation', async () => {
  const app = loadExportApp({ summaryCalls: [], auditCalls: [] })

  await withTestServer(app, async (baseUrl) => {
    const body = { type: 'daily', date: '2026-09-02', format: 'csv' }

    assert.equal((await requestExport(baseUrl, body)).status, 401)

    // The docx control authorizes exports for Admin, Managing Director, and
    // Operation Manager only — Asst. Operation Manager must be rejected here.
    assert.equal((await requestExport(baseUrl, body, authHeader('Production Supervisor'))).status, 403)
    assert.equal((await requestExport(baseUrl, body, authHeader('Asst. Operation Manager'))).status, 403)

    // View access to the summary endpoint is intentionally unchanged.
    const summary = await requestJson(baseUrl, '/api/reports/summary?type=daily', {
      headers: authHeader('Asst. Operation Manager'),
    })
    assert.equal(summary.response.status, 200)

    for (const invalid of [
      { type: 'daily', format: 'xls' },
      { type: 'yearly', format: 'csv' },
      { type: 'daily', date: '09-02-2026', format: 'csv' },
    ]) {
      const response = await requestExport(baseUrl, invalid, authHeader('Admin'))
      assert.equal(response.status, 400, JSON.stringify(invalid))
      const payload = await response.json()
      assertError(payload, 'VALIDATION_ERROR')
    }
  })
})

test('Export API streams server-generated CSV with attachment headers and records the audit entry', async () => {
  const summaryCalls = []
  const auditCalls = []
  const app = loadExportApp({ summaryCalls, auditCalls })

  await withTestServer(app, async (baseUrl) => {
    const response = await requestExport(
      baseUrl,
      { type: 'daily', date: '2026-09-02', format: 'csv' },
      authHeader('Admin'),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8')
    assert.equal(
      response.headers.get('content-disposition'),
      'attachment; filename="report-daily-2026-09-02.csv"',
    )

    const csv = await response.text()
    assert.ok(csv.includes('"Cause","Sensor","Events","Duration Minutes","Estimated Loss"'))
    assert.ok(csv.includes('"Corrective Maintenance","S-01 Coil Joint Replacement","2","45","3"'))

    assert.deepEqual(summaryCalls, [{ type: 'daily', date: '2026-09-02' }])

    assert.equal(auditCalls.length, 1)
    assert.equal(auditCalls[0].action, 'REPORT_EXPORTED')
    assert.equal(auditCalls[0].userId, USER_ID)
    assert.equal(auditCalls[0].entityType, 'report')
    assert.deepEqual(auditCalls[0].metadata, {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'csv',
      rowCount: 1,
      periodState: 'complete',
      observedStartAt: REPORT.observedStartAt,
      observedEndAt: REPORT.observedEndAt,
    })
  })
})

test('Export API streams PDF for Managing Director and Operation Manager', async () => {
  const auditCalls = []
  const app = loadExportApp({ summaryCalls: [], auditCalls })

  await withTestServer(app, async (baseUrl) => {
    for (const role of ['Managing Director', 'Operation Manager']) {
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

test('Export API limits repeated exports per user beyond the configured cap', async () => {
  const app = loadExportApp({ summaryCalls: [], auditCalls: [] })

  await withTestServer(app, async (baseUrl) => {
    const requests = await Promise.all(Array.from({ length: 11 }, () => requestExport(
      baseUrl,
      { type: 'daily', format: 'csv' },
      authHeader('Admin'),
    )))
    const limited = requests.filter((response) => response.status === 429)

    assert.equal(limited.length, 1)
    const payload = await limited[0].json()
    assertError(payload, 'RATE_LIMITED')
    assert.ok(limited[0].headers.get('retry-after'))
  })
})
