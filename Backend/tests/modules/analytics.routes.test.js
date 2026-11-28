const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const {
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('../helpers/appTestUtils')

const backendRoot = path.resolve(__dirname, '../..')
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const MACHINE_ID = '22222222-2222-4222-8222-222222222222'

function authHeader(role = 'Admin') {
  const token = jwt.sign(
    { username: role.toLowerCase().replaceAll(' ', ''), role },
    JWT_SECRET,
    { subject: USER_ID, expiresIn: '1h' },
  )
  return { Authorization: `Bearer ${token}` }
}

test('GET /api/analytics propagates production_calendar_days through getSettingsHistory and excludes non-working days from availability', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-25T12:00:00+08:00') })
  const settingsHistory = [{
    machine_id: MACHINE_ID,
    version: '1',
    shift_schedule: {
      workStart: '08:00',
      workEnd: '17:00',
      breaks: [],
      rampUpGraceMinutes: 0,
      restDays: ['sunday'],
    },
    effective_from: null,
    effective_to: null,
  }]
  const calendarDays = [
    { machine_id: MACHINE_ID, calendar_date: '2026-11-23', is_working: false },
  ]
  const downtimeRows = [
    {
      id: 'down-tue',
      machine_id: MACHINE_ID,
      started_at: '2026-11-24T08:00:00+08:00',
      ended_at: '2026-11-24T09:30:00+08:00',
      cause: 'Flux Refill',
      status: 'Resolved',
      sensors: { sensor_code: 'S-01' },
    },
  ]
  const fakeSupabase = {
    from(tableName) {
      const query = {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lte() { return this },
        lt() { return this },
        or() { return this },
        order() {
          if (tableName === 'sensors') {
            return Promise.resolve({
              data: [
                { sensor_code: 'S-01', label: 'Raw Material & Coil Joint' },
                { sensor_code: 'S-02', label: 'Inside Filler Wire' },
                { sensor_code: 'S-03', label: 'Machine Main Sensor' },
                { sensor_code: 'S-04', label: 'Outside Filler Wire' },
                { sensor_code: 'S-05', label: 'Production Output Cutting' },
              ],
              error: null,
            })
          }
          return this
        },
        range() {
          if (tableName === 'machine_operational_settings_history') {
            return Promise.resolve({ data: settingsHistory, error: null })
          }
          if (tableName === 'production_calendar_days') {
            return Promise.resolve({ data: calendarDays, error: null })
          }
          if (tableName === 'downtime_events') {
            return Promise.resolve({ data: downtimeRows, error: null })
          }
          return Promise.resolve({ data: [], error: null })
        },
        async maybeSingle() {
          if (tableName === 'machines') {
            return { data: { id: MACHINE_ID, name: 'Spiral Mill 01' }, error: null }
          }
          return { data: null, error: null }
        },
      }
      return query
    },
    rpc() {
      return Promise.resolve({ data: [], error: null })
    },
  }

  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) delete require.cache[cacheKey]
  })
  const app = loadAppWithMocks({
    'src/database/client.js': {
      getSupabaseClient: () => fakeSupabase,
    },
  })

  await withTestServer(app, async (baseUrl) => {
    const nonWorkingResult = await requestJson(
      baseUrl,
      '/api/analytics?startDate=2026-11-22&endDate=2026-11-23',
      { headers: authHeader('Admin') },
    )
    assert.equal(nonWorkingResult.response.status, 200)
    assert.equal(nonWorkingResult.body.analytics.selected.summary.availabilityPercent, null)

    const mixedResult = await requestJson(
      baseUrl,
      '/api/analytics?startDate=2026-11-22&endDate=2026-11-24',
      { headers: authHeader('Admin') },
    )
    assert.equal(mixedResult.response.status, 200)
    assert.equal(mixedResult.body.analytics.selected.trends[0].metrics.availabilityPercent, null)
    assert.equal(mixedResult.body.analytics.selected.trends[1].metrics.availabilityPercent, null)
    assert.equal(mixedResult.body.analytics.selected.trends[2].metrics.availabilityPercent, 83)
    assert.equal(mixedResult.body.analytics.selected.summary.availabilityPercent, 83)

    for (const invalidQuery of [
      'startDate=1999-12-31&endDate=2000-01-05',
      'startDate=2101-01-01&endDate=2101-01-05',
    ]) {
      const outOfBounds = await requestJson(baseUrl, `/api/analytics?${invalidQuery}`, {
        headers: authHeader('Admin'),
      })
      assert.equal(outOfBounds.response.status, 400, invalidQuery)
      assert.equal(outOfBounds.body?.error?.code, 'VALIDATION_ERROR')
    }
  })
})
