const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, requestJson, withTestServer } = require('../../helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const USER_ID = '33333333-3333-4333-8333-333333333333'

function authHeader(role) {
  const token = jwt.sign({ username: 'reports-user', role }, JWT_SECRET, {
    subject: USER_ID,
    expiresIn: '1h',
  })
  return { Authorization: `Bearer ${token}` }
}

const REGULAR_REPORT_STUB = {
  category: 'regular',
  generatedAt: '2026-08-09T08:00:00.000Z',
  reportType: 'daily',
  selectedDate: '2026-08-09',
  periodState: 'complete',
  summary: [],
  metrics: { outputPieces: 10 },
  processSensors: [],
  rows: [],
}

const PRODUCTION_REPORT_STUB = {
  category: 'production',
  generatedAt: '2026-08-09T08:00:00.000Z',
  reportType: 'daily',
  selectedDate: '2026-08-09',
  periodState: 'complete',
  totalProductionOutput: 42,
  specifiedPipes: 30,
  unspecifiedPipes: 12,
  distinctProductSizes: 3,
  metrics: {
    totalProductionOutput: 42,
    specifiedPipes: 30,
    unspecifiedPipes: 12,
    distinctProductSizes: 3,
  },
  summary: [],
  specBreakdown: [],
  productionLogs: [],
  rows: [],
}

function loadReportsApp({ summaryCalls = [] } = {}) {
  return loadAppWithMocks({
    'src/modules/reports/reports.service.js': {
      getSummary: async (query) => {
        summaryCalls.push(query)
        if (query.category === 'production') {
          return {
            ...PRODUCTION_REPORT_STUB,
            comparison: query.compare ? { metrics: PRODUCTION_REPORT_STUB.metrics } : undefined,
          }
        }
        return { ...REGULAR_REPORT_STUB }
      },
    },
  })
}

test('GET /api/reports/summary returns 401 when unauthenticated', async () => {
  const app = loadReportsApp()

  await withTestServer(app, async (baseUrl) => {
    const { response } = await requestJson(baseUrl, '/api/reports/summary')
    assert.equal(response.status, 401)
  })
})

test('GET /api/reports/summary enforces role authorization matrix', async () => {
  const app = loadReportsApp()

  await withTestServer(app, async (baseUrl) => {
    // Allowed view roles: Admin, Operation Manager, Asst. Operation Manager.
    for (const role of ['Admin', 'Operation Manager', 'Asst. Operation Manager']) {
      const { response } = await requestJson(baseUrl, '/api/reports/summary', {
        headers: authHeader(role),
      })
      assert.equal(response.status, 200, `Expected 200 for ${role}`)
    }

    // Denied roles: Production Supervisor, Quality Assurance Inspector, Maintenance Technician, Viewer.
    for (const role of ['Production Supervisor', 'Quality Assurance Inspector', 'Maintenance Technician', 'Viewer']) {
      const { response } = await requestJson(baseUrl, '/api/reports/summary', {
        headers: authHeader(role),
      })
      assert.equal(response.status, 403, `Expected 403 for ${role}`)
    }
  })
})

test('GET /api/reports/summary validates query parameters strictly', async () => {
  const app = loadReportsApp()

  await withTestServer(app, async (baseUrl) => {
    const invalidQueries = [
      '/api/reports/summary?category=unsupported',
      '/api/reports/summary?type=yearly',
      '/api/reports/summary?date=invalid-date',
      '/api/reports/summary?compare=not-a-boolean',
    ]

    for (const query of invalidQueries) {
      const { response, body } = await requestJson(baseUrl, query, {
        headers: authHeader('Admin'),
      })
      assert.equal(response.status, 400)
      assert.equal(body.error.code, 'VALIDATION_ERROR')
    }
  })
})

test('GET /api/reports/summary defaults to regular category with no-store header', async () => {
  const summaryCalls = []
  const app = loadReportsApp({ summaryCalls })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/reports/summary', {
      headers: authHeader('Operation Manager'),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(summaryCalls.length, 1)
    assert.equal(summaryCalls[0].category, 'regular')
    assert.equal(summaryCalls[0].type, 'daily')
    assert.equal(summaryCalls[0].compare, false)
    assert.equal(body.report.category, 'regular')
  })
})

test('GET /api/reports/summary returns production report with expected structure and comparison', async () => {
  const summaryCalls = []
  const app = loadReportsApp({ summaryCalls })

  await withTestServer(app, async (baseUrl) => {
    const path = '/api/reports/summary?category=production&type=weekly&date=2026-08-09&compare=true'
    const { response, body } = await requestJson(baseUrl, path, {
      headers: authHeader('Asst. Operation Manager'),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(summaryCalls.length, 1)
    assert.equal(summaryCalls[0].category, 'production')
    assert.equal(summaryCalls[0].type, 'weekly')
    assert.equal(summaryCalls[0].date, '2026-08-09')
    assert.equal(summaryCalls[0].compare, true)

    assert.equal(body.report.category, 'production')
    assert.equal(body.report.totalProductionOutput, 42)
    assert.equal(body.report.specifiedPipes, 30)
    assert.equal(body.report.unspecifiedPipes, 12)
    assert.equal(body.report.distinctProductSizes, 3)
    assert.ok(body.report.comparison)
  })
})

test('GET /api/reports/summary returns safe 500 when reports service fails', async () => {
  const app = loadAppWithMocks({
    'src/modules/reports/reports.service.js': {
      getSummary: async () => {
        const err = new Error('Database connection failed.')
        err.status = 500
        err.code = 'REPORT_PRODUCTION_SENSOR_MISSING'
        throw err
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/reports/summary?category=production', {
      headers: authHeader('Admin'),
    })

    assert.equal(response.status, 500)
    assert.equal(body.error.code, 'REPORT_PRODUCTION_SENSOR_MISSING')
    assert.equal(body.error.message, 'Unexpected server error.')
  })
})
