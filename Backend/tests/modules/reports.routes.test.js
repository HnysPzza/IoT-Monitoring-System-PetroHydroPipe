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

function buildShutdownCalendarDays() {
  const dates = [
    '2026-12-23',
    '2026-12-24',
    '2026-12-25',
    '2026-12-26',
    '2026-12-27',
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]
  return dates.map((calendarDate) => ({
    machine_id: MACHINE_ID,
    calendar_date: calendarDate,
    is_working: false,
  }))
}

test('getOutputLossBasis after a 12-day shutdown finds 0 qualified days in trailing 7 days and falls back to trailing-30-days without dividing by zero', async () => {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(backendRoot, 'src'))) delete require.cache[cacheKey]
  })
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
  const calendarDays = buildShutdownCalendarDays()
  const fakeSupabase = {
    from(tableName) {
      return {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lte() { return this },
        lt() { return this },
        or() { return this },
        order() { return this },
        range() {
          if (tableName === 'machine_operational_settings_history') {
            return Promise.resolve({ data: settingsHistory, error: null })
          }
          if (tableName === 'production_calendar_days') {
            return Promise.resolve({ data: calendarDays, error: null })
          }
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
  }
  const { getSettingsHistory } = require('../../src/modules/settings/settingsHistory.repository')
  const { getOutputLossBasis } = require('../../src/shared/outputLossBasis')

  const basis = await getOutputLossBasis({
    machineId: MACHINE_ID,
    asOf: new Date('2027-01-04T12:00:00+08:00'),
    fallbackRatePiecesPerMinute: 0.05,
    dependencies: {
      getSettingsHistory: (machineId, window) => getSettingsHistory(machineId, window, fakeSupabase),
      getOverlappingDowntime: async () => [],
      aggregateEvents: async () => [
        { bucket_start: '2026-12-16T16:00:00.000Z', sensor_code: 'S-05', event_count: 27 },
        { bucket_start: '2026-12-17T16:00:00.000Z', sensor_code: 'S-05', event_count: 27 },
        { bucket_start: '2026-12-18T16:00:00.000Z', sensor_code: 'S-05', event_count: 27 },
        { bucket_start: '2026-12-28T16:00:00.000Z', sensor_code: 'S-05', event_count: 30 },
        { bucket_start: '2026-12-29T16:00:00.000Z', sensor_code: 'S-05', event_count: 30 },
        { bucket_start: '2026-12-30T16:00:00.000Z', sensor_code: 'S-05', event_count: 30 },
      ],
    },
  })

  assert.equal(basis.source, 'trailing-30-days')
  assert.equal(basis.qualifiedProductionDays, 3)
  assert.equal(basis.productiveMinutes, 3 * 540)
  assert.equal(basis.outputPieces, 81)
  assert.equal(basis.ratePiecesPerMinute, 0.05)
})

test('GET /api/reports/summary returns 0 scheduledEligibleMinutes and N/A availability on non-working calendar dates', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-04T12:00:00+08:00') })
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
  const calendarDays = buildShutdownCalendarDays()
  const fakeSupabase = {
    from(tableName) {
      return {
        select() { return this },
        eq() { return this },
        gte() { return this },
        lte() { return this },
        lt() { return this },
        or() { return this },
        order() { return this },
        range() {
          if (tableName === 'machine_operational_settings_history') {
            return Promise.resolve({ data: settingsHistory, error: null })
          }
          if (tableName === 'production_calendar_days') {
            return Promise.resolve({ data: calendarDays, error: null })
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
    const response = await requestJson(
      baseUrl,
      '/api/reports/summary?type=daily&date=2026-12-25',
      { headers: authHeader('Admin') },
    )
    assert.equal(response.response.status, 200)
    assert.equal(response.body.report.metrics.scheduledEligibleMinutes, 0)
    assert.equal(response.body.report.metrics.availabilityPercent, null)
    const availabilityCard = response.body.report.summary.find((item) => item.id === 'availability')
    assert.equal(availabilityCard.value, 'N/A')
  })
})
