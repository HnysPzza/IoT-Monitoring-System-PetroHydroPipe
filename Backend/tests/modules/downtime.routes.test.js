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
const SUNDAY_DOWNTIME_ID = '33333333-3333-4333-8333-333333333331'
const HOLIDAY_DOWNTIME_ID = '33333333-3333-4333-8333-333333333332'
const WORKING_SHORT_DOWNTIME_ID = '33333333-3333-4333-8333-333333333333'

function authHeader(role = 'Admin') {
  const token = jwt.sign(
    { username: role.toLowerCase().replaceAll(' ', ''), role },
    JWT_SECRET,
    { subject: USER_ID, expiresIn: '1h' },
  )
  return { Authorization: `Bearer ${token}` }
}

function createFakeSupabase({ records, settingsHistory, calendarDays }) {
  return {
    from(tableName) {
      const sourceRecords = tableName === 'downtime_events'
        ? records
        : tableName === 'machine_operational_settings_history'
          ? settingsHistory
          : tableName === 'production_calendar_days'
            ? calendarDays
            : []
      const query = {
        filters: {},
        predicates: [],
        fromIndex: 0,
        toIndex: Number.POSITIVE_INFINITY,
        select() { return this },
        order() { return this },
        eq(field, value) { this.filters[field] = value; return this },
        gte(field, value) {
          if (tableName === 'production_calendar_days') {
            this.predicates.push((record) => record[field] >= value)
          }
          return this
        },
        lte(field, value) {
          if (tableName === 'production_calendar_days') {
            this.predicates.push((record) => record[field] <= value)
          }
          return this
        },
        lt(field, value) {
          this.predicates.push((record) => new Date(record[field]) < new Date(value))
          return this
        },
        or(value) {
          if (tableName === 'downtime_events') {
            const boundary = value.split('ended_at.gt.')[1]
            this.predicates.push((record) => record.ended_at == null || new Date(record.ended_at) > new Date(boundary))
          }
          return this
        },
        range(from, to) { this.fromIndex = from; this.toIndex = to; return this },
        matches(record) {
          return Object.entries(this.filters).every(([field, value]) => (
            record[field] === undefined || record[field] === value
          )) && this.predicates.every((predicate) => predicate(record))
        },
        async maybeSingle() {
          return { data: sourceRecords.find((record) => this.matches(record)) || null, error: null }
        },
        then(resolve, reject) {
          const matching = sourceRecords.filter((record) => this.matches(record))
          return Promise.resolve({
            data: matching.slice(this.fromIndex, this.toIndex + 1),
            count: matching.length,
            error: null,
          }).then(resolve, reject)
        },
      }
      return query
    },
    rpc(functionName, args) {
      return {
        async single() {
          assert.equal(functionName, 'update_downtime_record')
          const record = records.find((candidate) => candidate.id === args.p_downtime_id)
          if (!record) return { data: null, error: { code: 'P0002' } }
          if (args.p_cause != null) record.cause = args.p_cause
          if (args.p_has_notes) record.notes = args.p_notes
          return { data: { downtime_id: record.id }, error: null }
        },
      }
    },
  }
}

test('GET /api/downtime and PATCH /api/downtime/:id return outsideSchedule attribution from raw seconds and preserve metrics on update', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-23T09:00:20+08:00') })
  const records = [
    {
      id: HOLIDAY_DOWNTIME_ID,
      machine_id: MACHINE_ID,
      sensor_id: 'sensor-3',
      started_at: '2026-11-20T09:00:00+08:00',
      ended_at: '2026-11-20T09:45:00+08:00',
      duration_seconds: 2700,
      cause: 'Pending Cause Review',
      status: 'Resolved',
      notes: '',
      machines: { name: 'Spiral Mill 01' },
      sensors: { sensor_code: 'S-03', label: 'Machine Main Sensor' },
    },
    {
      id: SUNDAY_DOWNTIME_ID,
      machine_id: MACHINE_ID,
      sensor_id: 'sensor-3',
      started_at: '2026-11-22T09:00:00+08:00',
      ended_at: '2026-11-22T09:45:00+08:00',
      duration_seconds: 2700,
      cause: 'Pending Cause Review',
      status: 'Resolved',
      notes: '',
      machines: { name: 'Spiral Mill 01' },
      sensors: { sensor_code: 'S-03', label: 'Machine Main Sensor' },
    },
    {
      id: WORKING_SHORT_DOWNTIME_ID,
      machine_id: MACHINE_ID,
      sensor_id: 'sensor-3',
      started_at: '2026-11-23T09:00:00+08:00',
      ended_at: null,
      duration_seconds: null,
      cause: 'Pending Cause Review',
      status: 'Open',
      notes: '',
      machines: { name: 'Spiral Mill 01' },
      sensors: { sensor_code: 'S-03', label: 'Machine Main Sensor' },
    },
  ]
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
    { machine_id: MACHINE_ID, calendar_date: '2026-11-20', is_working: false },
  ]
  const fakeSupabase = createFakeSupabase({ records, settingsHistory, calendarDays })

  const app = loadAppWithMocks({
    'src/database/client.js': {
      getSupabaseClient: () => fakeSupabase,
    },
    'src/shared/outputLossBasis.js': {
      getOutputLossBasis: async () => ({
        source: 'configured-fallback',
        ratePiecesPerMinute: 0.05,
        windowStartAt: '2026-10-24T16:00:00.000Z',
        windowEndAt: '2026-11-22T16:00:00.000Z',
        qualifiedProductionDays: 0,
        productiveMinutes: 0,
        outputPieces: 0,
      }),
    },
  })
  delete require.cache[require.resolve(path.join(backendRoot, 'src/modules/downtime/downtime.service.js'))]

  await withTestServer(app, async (baseUrl) => {
    const listResponse = await requestJson(
      baseUrl,
      '/api/downtime?dateFrom=2026-11-20&dateTo=2026-11-23',
      { headers: authHeader('Admin') },
    )
    assert.equal(listResponse.response.status, 200)

    const byId = new Map(listResponse.body.records.map((record) => [record.id, record]))
    const sundayRecord = byId.get(SUNDAY_DOWNTIME_ID)
    assert.equal(sundayRecord.durationMinutes, 45)
    assert.equal(sundayRecord.unplannedMinutes, 0)
    assert.equal(sundayRecord.plannedExcludedMinutes, 45)
    assert.equal(sundayRecord.estimatedLoss, 0)
    assert.equal(sundayRecord.outsideSchedule, true)

    const holidayRecord = byId.get(HOLIDAY_DOWNTIME_ID)
    assert.equal(holidayRecord.durationMinutes, 45)
    assert.equal(holidayRecord.unplannedMinutes, 0)
    assert.equal(holidayRecord.plannedExcludedMinutes, 45)
    assert.equal(holidayRecord.estimatedLoss, 0)
    assert.equal(holidayRecord.outsideSchedule, true)

    const workingShortRecord = byId.get(WORKING_SHORT_DOWNTIME_ID)
    assert.equal(workingShortRecord.durationMinutes, 0)
    assert.equal(workingShortRecord.unplannedMinutes, 0)
    assert.equal(workingShortRecord.plannedExcludedMinutes, 0)
    assert.equal(workingShortRecord.outsideSchedule, false)

    const patchSunday = await requestJson(
      baseUrl,
      `/api/downtime/${SUNDAY_DOWNTIME_ID}`,
      {
        method: 'PATCH',
        headers: authHeader('Admin'),
        body: { cause: 'Corrective Maintenance', notes: 'Weekend sensor check' },
      },
    )
    assert.equal(patchSunday.response.status, 200)
    assert.equal(patchSunday.body.record.cause, 'Corrective Maintenance')
    assert.equal(patchSunday.body.record.durationMinutes, 45)
    assert.equal(patchSunday.body.record.unplannedMinutes, 0)
    assert.equal(patchSunday.body.record.plannedExcludedMinutes, 45)
    assert.equal(patchSunday.body.record.estimatedLoss, 0)
    assert.equal(patchSunday.body.record.outsideSchedule, true)

    const patchWorkingShort = await requestJson(
      baseUrl,
      `/api/downtime/${WORKING_SHORT_DOWNTIME_ID}`,
      {
        method: 'PATCH',
        headers: authHeader('Admin'),
        body: { notes: 'Brief working-hour stop' },
      },
    )
    assert.equal(patchWorkingShort.response.status, 200)
    assert.equal(patchWorkingShort.body.record.durationMinutes, 0)
    assert.equal(patchWorkingShort.body.record.plannedExcludedMinutes, 0)
    assert.equal(patchWorkingShort.body.record.outsideSchedule, false)
  })
})
