const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, withTestServer } = require('../../helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const MACHINE_ID = '33333333-3333-4333-8333-333333333333'
const EVENT_ID = '44444444-4444-4444-8444-444444444444'
const ALERT_ID = '55555555-5555-4555-8555-555555555555'
const DOWNTIME_ID = '66666666-6666-4666-8666-666666666666'

function authHeaders(userId, role = 'Admin') {
  const token = jwt.sign({ username: `user-${userId.slice(-2)}`, role }, JWT_SECRET, {
    subject: userId,
    expiresIn: '1h',
  })
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

test('parser errors return stable JSON without reflecting submitted credentials', async () => {
  await withTestServer(loadAppWithMocks(), async (baseUrl) => {
    for (const [body, status, code, message] of [
      ['{"password":"SYNTHETIC_ONLY", nope}', 400, 'INVALID_JSON', 'Request body must contain valid JSON.'],
      [JSON.stringify({ password: 'x'.repeat(110000) }), 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'],
    ]) {
      const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      assert.equal(response.status, status)
      assert.deepEqual(await response.json(), { error: { code, message } })
    }
  })
})

test('setup rate limits return structured JSON and retry timing', async () => {
  await withTestServer(loadAppWithMocks(), async (baseUrl) => {
    let response
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await fetch(`${baseUrl}/api/auth/setup-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    }
    assert.equal(response.status, 429)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.ok(Number(response.headers.get('retry-after')) > 0)
    assert.equal((await response.json()).error.code, 'RATE_LIMITED')
  })
})

test('heavyReadRateLimiter caps dashboard overview, production list, and audit reads per user at 60/min', async () => {
  const app = loadAppWithMocks({
    'src/modules/dashboard/dashboard.service.js': {
      getOverview: async () => ({ alerts: [], summary: [], productionAnalytics: {}, downtimeImpact: {}, availability: [], unreadAlerts: 0 }),
      getDowntimeImpact: async () => ({ thresholdMinutes: 30, points: [] }),
    },
    'src/modules/production/production.service.js': {
      listProductionLogs: async () => ({ records: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 }, summary: {} }),
    },
    'src/modules/audit/audit.service.js': {
      listAuditLogs: async () => ({ logs: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } }),
      recordAuditLog: async () => {},
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const readPaths = ['/api/dashboard/overview', '/api/dashboard/downtime-impact', '/api/production', '/api/audit']
    for (let idx = 0; idx < readPaths.length; idx += 1) {
      const pathName = readPaths[idx]
      const userAHeaders = authHeaders(`33333333-3333-4333-8333-00000000000${idx + 1}`, 'Admin')
      const userBHeaders = authHeaders(`44444444-4444-4444-8444-00000000000${idx + 1}`, 'Admin')
      for (let i = 0; i < 60; i += 1) {
        const res = await fetch(`${baseUrl}${pathName}`, { headers: userAHeaders })
        assert.equal(res.status, 200, `${pathName} #${i + 1}`)
      }
      const limited = await fetch(`${baseUrl}${pathName}`, { headers: userAHeaders })
      assert.equal(limited.status, 429, `${pathName} should rate limit at 61`)
      assert.ok(Number(limited.headers.get('retry-after')) > 0)
      assert.equal((await limited.json()).error.code, 'RATE_LIMITED')

      const isolated = await fetch(`${baseUrl}${pathName}`, { headers: userBHeaders })
      assert.equal(isolated.status, 200, `${pathName} user B must stay isolated`)
    }
  })
})

test('userWriteRateLimiter caps production, alert, downtime, settings, and calendar writes per user at 30/min', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.service.js': {
      updateProductionLogSpec: async () => ({ record: { id: EVENT_ID } }),
      batchUpdateProductionLogSpecs: async () => ({ updatedCount: 1, records: [] }),
    },
    'src/modules/alerts/alerts.service.js': {
      acknowledgeAlert: async () => ({ id: ALERT_ID, status: 'Acknowledged' }),
    },
    'src/modules/downtime/downtime.service.js': {
      updateDowntime: async () => ({ record: { id: DOWNTIME_ID } }),
    },
    'src/modules/settings/settings.service.js': {
      getSettingsConstraints: () => ({}),
      getMachineSettingsForRead: async () => ({}),
      updateMachineSettings: async () => ({ machineId: MACHINE_ID, version: '2' }),
    },
    'src/modules/calendar/calendar.service.js': {
      setProductionCalendarDay: async () => ({ entry: { calendarDate: '2026-12-20' } }),
    },
  })

  const writeCases = [
    { pathName: `/api/production/${EVENT_ID}`, method: 'PATCH', body: { label: 'Pipe' } },
    { pathName: '/api/production/batch', method: 'PATCH', body: { sensorEventIds: [EVENT_ID], label: 'Pipe' } },
    { pathName: `/api/alerts/${ALERT_ID}/acknowledge`, method: 'PATCH', body: {} },
    { pathName: `/api/downtime/${DOWNTIME_ID}`, method: 'PATCH', body: { notes: 'Checked' } },
    {
      pathName: `/api/machines/${MACHINE_ID}/settings`,
      method: 'PATCH',
      body: { expectedVersion: '1', sensorThresholds: { 'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null } } },
    },
    {
      pathName: `/api/machines/${MACHINE_ID}/calendar/days/2026-12-20`,
      method: 'PUT',
      body: { dayType: 'day_off', name: 'Plant Maintenance' },
    },
  ]

  await withTestServer(app, async (baseUrl) => {
    for (let idx = 0; idx < writeCases.length; idx += 1) {
      const testCase = writeCases[idx]
      const userId = `11111111-1111-4111-8111-0000000000${String(idx + 1).padStart(2, '0')}`
      const otherUserId = `22222222-2222-4222-8222-0000000000${String(idx + 1).padStart(2, '0')}`
      const headersA = authHeaders(userId, 'Admin')
      const headersB = authHeaders(otherUserId, 'Admin')

      for (let i = 0; i < 30; i += 1) {
        const res = await fetch(`${baseUrl}${testCase.pathName}`, {
          method: testCase.method,
          headers: headersA,
          body: JSON.stringify(testCase.body),
        })
        assert.equal(res.status, 200, `${testCase.pathName} #${i + 1}`)
      }

      const limited = await fetch(`${baseUrl}${testCase.pathName}`, {
        method: testCase.method,
        headers: headersA,
        body: JSON.stringify(testCase.body),
      })
      assert.equal(limited.status, 429, `${testCase.pathName} should rate limit at 31`)
      assert.ok(Number(limited.headers.get('retry-after')) > 0)
      assert.equal((await limited.json()).error.code, 'RATE_LIMITED')

      const isolated = await fetch(`${baseUrl}${testCase.pathName}`, {
        method: testCase.method,
        headers: headersB,
        body: JSON.stringify(testCase.body),
      })
      assert.equal(isolated.status, 200, `${testCase.pathName} other user must stay isolated`)
    }
  })
})
