const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { loadAppWithMocks, requestJson, withTestServer } = require('./helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function authHeader(role) {
  const token = jwt.sign({ username: 'analytics-user', role }, JWT_SECRET, {
    subject: USER_ID,
    expiresIn: '1h',
  })
  return { Authorization: `Bearer ${token}` }
}

test('Analytics API validates dates, enforces roles, and returns the service contract', async () => {
  const calls = []
  const analytics = { generatedAt: '2026-08-29T02:00:00.000Z', selected: {}, comparison: {} }
  const app = loadAppWithMocks({
    'src/modules/analytics/analytics.service.js': {
      getAnalytics: async (query) => {
        calls.push(query)
        return analytics
      },
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const path = '/api/analytics?startDate=2026-08-01&endDate=2026-08-07'
    assert.equal((await requestJson(baseUrl, path)).response.status, 401)
    assert.equal((await requestJson(baseUrl, path, { headers: authHeader('Production Supervisor') })).response.status, 403)

    for (const role of ['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Managing Director']) {
      const result = await requestJson(baseUrl, path, { headers: authHeader(role) })
      assert.equal(result.response.status, 200, role)
      assert.deepEqual(result.body, { analytics })
    }

    assert.deepEqual(calls[0], { startDate: '2026-08-01', endDate: '2026-08-07' })
    const allTime = await requestJson(baseUrl, '/api/analytics?range=all', { headers: authHeader('Admin') })
    assert.equal(allTime.response.status, 200)
    assert.deepEqual(calls.at(-1), { range: 'all' })
    assert.equal((await requestJson(baseUrl, '/api/analytics?range=all&startDate=2026-08-01', {
      headers: authHeader('Admin'),
    })).response.status, 400)
    assert.equal((await requestJson(baseUrl, '/api/analytics?startDate=bad&endDate=2026-08-07', {
      headers: authHeader('Admin'),
    })).response.status, 400)
    assert.equal((await requestJson(baseUrl, '/api/analytics?startDate=2026-08-08&endDate=2026-08-07', {
      headers: authHeader('Admin'),
    })).response.status, 400)
    assert.equal((await requestJson(baseUrl, '/api/analytics?startDate=2025-01-01&endDate=2026-08-07', {
      headers: authHeader('Admin'),
    })).response.status, 400)
  })
})
