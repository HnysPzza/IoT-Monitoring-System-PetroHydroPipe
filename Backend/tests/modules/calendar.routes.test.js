const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const { formatBusinessDate } = require('../../src/shared/businessTime')
const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('../helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const userId = '11111111-1111-4111-8111-111111111111'
const machineId = '22222222-2222-4222-8222-222222222222'
const groupId = '33333333-3333-4333-8333-333333333333'

const dashboardRoles = [
  'Admin',
  'Operation Manager',
  'Production Supervisor',
  'Quality Control',
  'Engineering Supervisor',
]

const nonCalendarEditRoles = [
  'Operation Manager',
  'Production Supervisor',
  'Quality Control',
]

const calendarEditRoles = [
  'Admin',
  'Engineering Supervisor',
]

function authHeader(role = 'Admin') {
  const token = jwt.sign(
    { username: role.toLowerCase().replaceAll(' ', ''), role },
    JWT_SECRET,
    { subject: userId, expiresIn: '1h' },
  )
  return { Authorization: `Bearer ${token}` }
}

function sampleDbEntry(overrides = {}) {
  return {
    machine_id: machineId,
    calendar_date: '2026-12-25',
    name: 'Christmas Day',
    day_type: 'holiday',
    is_working: false,
    reason: null,
    source: 'seeded',
    group_id: null,
    version: 1,
    updated_by: null,
    updated_at: '2026-11-16T00:00:00.000Z',
    ...overrides,
  }
}

function createSupabaseMock({
  machineExists = true,
  calendarRows = [sampleDbEntry()],
  calendarQueryError = null,
  rpcHandler = async () => ({ data: null, error: null }),
  calls = [],
} = {}) {
  return {
    from(table) {
      calls.push({ type: 'from', table })
      const filters = []
      const builder = {
        select(columns) {
          calls.push({ type: 'select', table, columns })
          return builder
        },
        eq(column, value) {
          filters.push({ op: 'eq', column, value })
          calls.push({ type: 'eq', table, column, value })
          return builder
        },
        gte(column, value) {
          filters.push({ op: 'gte', column, value })
          calls.push({ type: 'gte', table, column, value })
          return builder
        },
        lte(column, value) {
          filters.push({ op: 'lte', column, value })
          calls.push({ type: 'lte', table, column, value })
          return builder
        },
        order(column, options) {
          calls.push({ type: 'order', table, column, options })
          return Promise.resolve({
            data: calendarQueryError ? null : calendarRows,
            error: calendarQueryError,
          })
        },
        async maybeSingle() {
          if (table === 'machines') {
            return {
              data: machineExists ? { id: machineId } : null,
              error: null,
            }
          }
          return { data: null, error: null }
        },
      }
      return builder
    },
    rpc(functionName, args) {
      calls.push({ type: 'rpc', functionName, args })
      const promise = Promise.resolve(rpcHandler(functionName, args))
      promise.maybeSingle = async () => {
        const result = await promise
        return {
          data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
          error: result.error,
        }
      }
      return promise
    },
  }
}

test('GET /api/machines/:machineId/calendar allows all dashboard roles and returns camelCase entries', async () => {
  const calls = []
  const rows = [
    sampleDbEntry({
      calendar_date: '2026-11-30',
      name: 'Bonifacio Day',
      day_type: 'holiday',
      is_working: true,
      source: 'seeded',
      version: 1,
    }),
    sampleDbEntry({
      calendar_date: '2026-12-25',
      name: 'Christmas Day',
      day_type: 'holiday',
      is_working: false,
      source: 'seeded',
      version: 2,
      updated_by: userId,
    }),
  ]
  const client = createSupabaseMock({ calendarRows: rows, calls })
  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => client },
  })

  await withTestServer(app, async (baseUrl) => {
    for (const role of dashboardRoles) {
      const { response, body } = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar?from=2026-11-01&to=2027-12-31`,
        { headers: authHeader(role) },
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.deepEqual(body, {
        entries: [
          {
            calendarDate: '2026-11-30',
            name: 'Bonifacio Day',
            dayType: 'holiday',
            isWorking: true,
            reason: null,
            source: 'seeded',
            groupId: null,
            version: '1',
            updatedBy: null,
            updatedAt: '2026-11-16T00:00:00.000Z',
          },
          {
            calendarDate: '2026-12-25',
            name: 'Christmas Day',
            dayType: 'holiday',
            isWorking: false,
            reason: null,
            source: 'seeded',
            groupId: null,
            version: '2',
            updatedBy: userId,
            updatedAt: '2026-11-16T00:00:00.000Z',
          },
        ],
      })
    }

    assert.ok(calls.some((call) => call.type === 'gte' && call.column === 'calendar_date' && call.value === '2026-11-01'))
    assert.ok(calls.some((call) => call.type === 'lte' && call.column === 'calendar_date' && call.value === '2027-12-31'))
  })
})

test('PUT /api/machines/:machineId/calendar/days/:calendarDate toggles a holiday and saves single-day exclusions as Admin', async () => {
  const calls = []
  const client = createSupabaseMock({
    calls,
    rpcHandler: async (functionName, args) => {
      assert.equal(functionName, 'set_production_calendar_day')
      return {
        data: [
          sampleDbEntry({
            calendar_date: args.p_calendar_date,
            name: args.p_name,
            day_type: args.p_day_type,
            is_working: args.p_is_working,
            reason: args.p_reason,
            source: args.p_day_type === 'holiday' ? 'seeded' : 'manual',
            version: 2,
            updated_by: args.p_actor_id,
          }),
        ],
        error: null,
      }
    },
  })
  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => client },
  })

  await withTestServer(app, async (baseUrl) => {
    const holidayResponse = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2026-12-25`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: {
          dayType: 'holiday',
          name: 'Christmas Day',
          isWorking: true,
          expectedVersion: '1',
        },
      },
    )

    assert.equal(holidayResponse.response.status, 200)
    assert.equal(holidayResponse.response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(holidayResponse.body, {
      entry: {
        calendarDate: '2026-12-25',
        name: 'Christmas Day',
        dayType: 'holiday',
        isWorking: true,
        reason: null,
        source: 'seeded',
        groupId: null,
        version: '2',
        updatedBy: userId,
        updatedAt: '2026-11-16T00:00:00.000Z',
      },
    })

    const unscheduledResponse = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2027-07-20`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: {
          dayType: 'machine_not_scheduled',
          name: 'Spiral Mill Unscheduled',
          reason: 'No orders',
        },
      },
    )

    assert.equal(unscheduledResponse.response.status, 200)
    assert.equal(unscheduledResponse.body.entry.dayType, 'machine_not_scheduled')
    assert.equal(unscheduledResponse.body.entry.isWorking, false)
    assert.equal(unscheduledResponse.body.entry.reason, 'No orders')
    assert.equal(unscheduledResponse.body.entry.source, 'manual')
  })
})

test('POST /api/machines/:machineId/calendar/ranges saves a multi-day range and returns groupId and entries', async () => {
  const calls = []
  const rangeDates = [
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
  const client = createSupabaseMock({
    calls,
    rpcHandler: async (functionName, args) => {
      assert.equal(functionName, 'set_production_calendar_range')
      return {
        data: rangeDates.map((calendarDate) => sampleDbEntry({
          calendar_date: calendarDate,
          name: args.p_name,
          day_type: args.p_day_type,
          is_working: false,
          reason: args.p_reason,
          source: 'manual',
          group_id: groupId,
          version: 1,
          updated_by: args.p_actor_id,
        })),
        error: null,
      }
    },
  })
  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => client },
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/ranges`,
      {
        method: 'POST',
        headers: authHeader('Admin'),
        body: {
          startDate: '2026-12-23',
          endDate: '2027-01-03',
          dayType: 'day_off',
          name: 'Christmas and New Year Shutdown',
        },
      },
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(body.groupId, groupId)
    assert.equal(body.entries.length, 12)
    assert.equal(body.entries[0].calendarDate, '2026-12-23')
    assert.equal(body.entries[11].calendarDate, '2027-01-03')
    assert.ok(body.entries.every((entry) => entry.groupId === groupId && entry.isWorking === false))
  })
})

test('DELETE calendar day and group endpoints invoke removal RPCs and return removal and restored holiday summaries', async () => {
  const calls = []
  const client = createSupabaseMock({
    calls,
    rpcHandler: async (functionName, args) => {
      if (functionName === 'remove_production_calendar_day') {
        return {
          data: {
            machineId: args.p_machine_id,
            calendarDate: args.p_calendar_date,
            removedCount: 1,
            removedDates: [args.p_calendar_date],
            lockedDates: [],
            restoredDates: ['2027-05-01'],
            restoredHolidays: [
              {
                calendarDate: '2027-05-01',
                name: 'Labor Day',
                dayType: 'holiday',
                isWorking: true,
                source: 'seeded',
                version: 2,
              },
            ],
          },
          error: null,
        }
      }

      if (functionName === 'remove_production_calendar_range') {
        return {
          data: {
            machineId: args.p_machine_id,
            groupId: args.p_group_id,
            removedCount: 5,
            removedDates: ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'],
            lockedDates: ['2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29'],
            restoredDates: ['2026-12-30', '2026-12-31', '2027-01-01'],
            restoredHolidays: [
              {
                calendarDate: '2026-12-30',
                name: 'Rizal Day',
                dayType: 'holiday',
                isWorking: false,
                source: 'seeded',
                version: 1,
              },
            ],
          },
          error: null,
        }
      }

      return { data: null, error: null }
    },
  })
  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => client },
  })

  await withTestServer(app, async (baseUrl) => {
    const dayDelete = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2027-05-01`,
      {
        method: 'DELETE',
        headers: authHeader('Admin'),
      },
    )
    assert.equal(dayDelete.response.status, 200)
    assert.equal(dayDelete.body.result.removedCount, 1)
    assert.deepEqual(dayDelete.body.result.restoredDates, ['2027-05-01'])
    assert.equal(dayDelete.body.result.restoredHolidays[0].name, 'Labor Day')

    const groupDelete = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/groups/${groupId}`,
      {
        method: 'DELETE',
        headers: authHeader('Admin'),
      },
    )
    assert.equal(groupDelete.response.status, 200)
    assert.equal(groupDelete.body.result.groupId, groupId)
    assert.equal(groupDelete.body.result.removedCount, 5)
    assert.equal(groupDelete.body.result.lockedDates.length, 7)
    assert.deepEqual(groupDelete.body.result.restoredDates, ['2026-12-30', '2026-12-31', '2027-01-01'])
  })
})

test('calendar write endpoints allow Admin and Engineering Supervisor and return 403 for other roles', async () => {
  const calls = []
  const client = createSupabaseMock({
    calls,
    rpcHandler: async (functionName, args) => {
      if (functionName === 'set_production_calendar_day') {
        return {
          data: [
            sampleDbEntry({
              calendar_date: args.p_calendar_date,
              name: args.p_name,
              day_type: args.p_day_type,
              is_working: args.p_is_working,
              reason: args.p_reason,
              source: args.p_day_type === 'holiday' ? 'seeded' : 'manual',
              version: 2,
              updated_by: args.p_actor_id,
            }),
          ],
          error: null,
        }
      }
      if (functionName === 'set_production_calendar_range') {
        return {
          data: [
            sampleDbEntry({
              calendar_date: args.p_start_date,
              name: args.p_name,
              day_type: args.p_day_type,
              is_working: false,
              reason: args.p_reason,
              source: 'manual',
              group_id: groupId,
              version: 1,
              updated_by: args.p_actor_id,
            }),
          ],
          error: null,
        }
      }
      if (functionName === 'remove_production_calendar_day' || functionName === 'remove_production_calendar_range') {
        return {
          data: {
            machineId: args.p_machine_id,
            removedCount: 1,
            removedDates: ['2026-12-25'],
            lockedDates: [],
            restoredDates: [],
            restoredHolidays: [],
          },
          error: null,
        }
      }
      return { data: null, error: null }
    },
  })
  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => client },
  })

  await withTestServer(app, async (baseUrl) => {
    for (const role of nonCalendarEditRoles) {
      const putRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/days/2026-12-25`,
        {
          method: 'PUT',
          headers: authHeader(role),
          body: { dayType: 'holiday', name: 'Christmas Day', isWorking: true },
        },
      )
      assert.equal(putRes.response.status, 403)
      assertError(putRes.body, 'FORBIDDEN')

      const postRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/ranges`,
        {
          method: 'POST',
          headers: authHeader(role),
          body: {
            startDate: '2026-12-23',
            endDate: '2027-01-03',
            dayType: 'day_off',
            name: 'Holiday Shutdown',
          },
        },
      )
      assert.equal(postRes.response.status, 403)
      assertError(postRes.body, 'FORBIDDEN')

      const deleteDayRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/days/2026-12-25`,
        {
          method: 'DELETE',
          headers: authHeader(role),
        },
      )
      assert.equal(deleteDayRes.response.status, 403)
      assertError(deleteDayRes.body, 'FORBIDDEN')

      const deleteGroupRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/groups/${groupId}`,
        {
          method: 'DELETE',
          headers: authHeader(role),
        },
      )
      assert.equal(deleteGroupRes.response.status, 403)
      assertError(deleteGroupRes.body, 'FORBIDDEN')
    }

    assert.equal(calls.some((call) => call.type === 'rpc'), false)

    for (const role of calendarEditRoles) {
      const putRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/days/2026-12-25`,
        {
          method: 'PUT',
          headers: authHeader(role),
          body: { dayType: 'holiday', name: 'Christmas Day', isWorking: true },
        },
      )
      assert.equal(putRes.response.status, 200, role)

      const postRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/ranges`,
        {
          method: 'POST',
          headers: authHeader(role),
          body: {
            startDate: '2026-12-23',
            endDate: '2026-12-23',
            dayType: 'day_off',
            name: 'Holiday Shutdown',
          },
        },
      )
      assert.equal(postRes.response.status, 200, role)

      const deleteDayRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/days/2026-12-25`,
        {
          method: 'DELETE',
          headers: authHeader(role),
        },
      )
      assert.equal(deleteDayRes.response.status, 200, role)

      const deleteGroupRes = await requestJson(
        baseUrl,
        `/api/machines/${machineId}/calendar/groups/${groupId}`,
        {
          method: 'DELETE',
          headers: authHeader(role),
        },
      )
      assert.equal(deleteGroupRes.response.status, 200, role)
    }
  })
})

test('calendar mutations reject missing machine_not_scheduled reason, today or past dates, and ranges over 62 days with 400', async () => {
  const calls = []
  const client = createSupabaseMock({ calls })
  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => client },
  })
  const manilaToday = formatBusinessDate(new Date())

  await withTestServer(app, async (baseUrl) => {
    const missingReasonDay = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2027-07-20`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: {
          dayType: 'machine_not_scheduled',
          name: 'Unscheduled Day',
          reason: '   ',
        },
      },
    )
    assert.equal(missingReasonDay.response.status, 400)
    assertError(missingReasonDay.body, 'VALIDATION_ERROR')

    const missingReasonRange = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/ranges`,
      {
        method: 'POST',
        headers: authHeader('Admin'),
        body: {
          startDate: '2027-07-20',
          endDate: '2027-07-21',
          dayType: 'machine_not_scheduled',
          name: 'Unscheduled Range',
        },
      },
    )
    assert.equal(missingReasonRange.response.status, 400)
    assertError(missingReasonRange.body, 'VALIDATION_ERROR')

    const sameDayMutation = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/${manilaToday}`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: {
          dayType: 'day_off',
          name: 'Same Day Closure',
        },
      },
    )
    assert.equal(sameDayMutation.response.status, 400)
    assertError(sameDayMutation.body, 'VALIDATION_ERROR')

    const pastDateMutation = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2020-01-01`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: {
          dayType: 'day_off',
          name: 'Past Closure',
        },
      },
    )
    assert.equal(pastDateMutation.response.status, 400)
    assertError(pastDateMutation.body, 'VALIDATION_ERROR')

    const over62DaysRange = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/ranges`,
      {
        method: 'POST',
        headers: authHeader('Admin'),
        body: {
          startDate: '2027-01-01',
          endDate: '2027-03-04',
          dayType: 'day_off',
          name: 'Excessive Shutdown',
        },
      },
    )
    assert.equal(over62DaysRange.response.status, 400)
    assertError(over62DaysRange.body, 'VALIDATION_ERROR')

    assert.equal(calls.some((call) => call.type === 'rpc'), false)
  })
})

test('calendar mutations map SQL 23505 manual overwrite conflicts and 40001 version conflicts to 409', async () => {
  let nextRpcError = {
    code: '23505',
    message: 'Manual production calendar entries already exist in the selected range.',
    detail: '["2027-07-20"]',
  }
  const client = createSupabaseMock({
    rpcHandler: async () => ({ data: null, error: nextRpcError }),
  })
  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => client },
  })

  await withTestServer(app, async (baseUrl) => {
    const overwriteConflict = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/ranges`,
      {
        method: 'POST',
        headers: authHeader('Admin'),
        body: {
          startDate: '2027-07-19',
          endDate: '2027-07-21',
          dayType: 'day_off',
          name: 'Overlapping Shutdown',
          confirmOverwrite: false,
        },
      },
    )
    assert.equal(overwriteConflict.response.status, 409)
    assertError(overwriteConflict.body, 'CALENDAR_OVERWRITE_CONFIRM_REQUIRED')
    assert.deepEqual(overwriteConflict.body.error.details, {
      conflictingDates: ['2027-07-20'],
    })

    nextRpcError = {
      code: '40001',
      message: 'Production calendar entry version conflict.',
    }
    const versionConflict = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2026-12-25`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: {
          dayType: 'holiday',
          name: 'Christmas Day',
          isWorking: true,
          expectedVersion: '1',
        },
      },
    )
    assert.equal(versionConflict.response.status, 409)
    assertError(versionConflict.body, 'CALENDAR_VERSION_CONFLICT')
  })
})

test('calendar endpoints enforce authentication, query validation, 404 mapping, SQL 22023 mapping, and fail-closed row parsing', async () => {
  let machineExists = false
  let calendarRows = [sampleDbEntry()]
  let nextRpcError = null

  const client = createSupabaseMock({
    rpcHandler: async () => ({ data: null, error: nextRpcError }),
  })
  const dynamicClient = {
    ...client,
    from(table) {
      const base = createSupabaseMock({
        machineExists,
        calendarRows,
        rpcHandler: async () => ({ data: null, error: nextRpcError }),
      })
      return base.from(table)
    },
    rpc(functionName, args) {
      return createSupabaseMock({
        machineExists,
        calendarRows,
        rpcHandler: async () => ({ data: null, error: nextRpcError }),
      }).rpc(functionName, args)
    },
  }

  const app = loadAppWithMocks({
    'src/database/client.js': { getSupabaseClient: () => dynamicClient },
  })

  await withTestServer(app, async (baseUrl) => {
    const unauthRes = await requestJson(baseUrl, `/api/machines/${machineId}/calendar`)
    assert.equal(unauthRes.response.status, 401)

    const missingMachineGet = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar`,
      { headers: authHeader('Admin') },
    )
    assert.equal(missingMachineGet.response.status, 404)
    assertError(missingMachineGet.body, 'MACHINE_NOT_FOUND')

    machineExists = true

    const reversedQuery = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar?from=2027-01-10&to=2027-01-01`,
      { headers: authHeader('Admin') },
    )
    assert.equal(reversedQuery.response.status, 400)
    assertError(reversedQuery.body, 'VALIDATION_ERROR')

    const invalidDateQuery = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar?from=2026-02-30`,
      { headers: authHeader('Admin') },
    )
    assert.equal(invalidDateQuery.response.status, 400)
    assertError(invalidDateQuery.body, 'VALIDATION_ERROR')

    const dayOffWorkingTrue = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2026-12-20`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: {
          dayType: 'day_off',
          name: 'Invalid Working Day Off',
          isWorking: true,
        },
      },
    )
    assert.equal(dayOffWorkingTrue.response.status, 400)
    assertError(dayOffWorkingTrue.body, 'VALIDATION_ERROR')

    nextRpcError = {
      code: 'P0002',
      message: 'Production calendar entry not found.',
    }
    const missingEntryDelete = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2027-05-01`,
      {
        method: 'DELETE',
        headers: authHeader('Admin'),
      },
    )
    assert.equal(missingEntryDelete.response.status, 404)
    assertError(missingEntryDelete.body, 'CALENDAR_ENTRY_NOT_FOUND')

    nextRpcError = {
      code: '22023',
      message: 'Seeded holidays cannot be removed; toggle is_working instead.',
    }
    const seededDelete = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2026-12-25`,
      {
        method: 'DELETE',
        headers: authHeader('Admin'),
      },
    )
    assert.equal(seededDelete.response.status, 400)
    assertError(seededDelete.body, 'VALIDATION_ERROR')

    calendarRows = [sampleDbEntry({ version: '01' })]
    const malformedGet = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar`,
      { headers: authHeader('Admin') },
    )
    assert.equal(malformedGet.response.status, 500)
    assertError(malformedGet.body, 'CALENDAR_QUERY_FAILED')
    calendarRows = [sampleDbEntry()]

    const outOfRangeGet = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar?from=1999-12-31`,
      { headers: authHeader('Admin') },
    )
    assert.equal(outOfRangeGet.response.status, 400)
    assertError(outOfRangeGet.body, 'VALIDATION_ERROR')

    const outOfRangePut = await requestJson(
      baseUrl,
      `/api/machines/${machineId}/calendar/days/2101-01-01`,
      {
        method: 'PUT',
        headers: authHeader('Admin'),
        body: { dayType: 'day_off', name: 'Future Out of Range' },
      },
    )
    assert.equal(outOfRangePut.response.status, 400)
    assertError(outOfRangePut.body, 'VALIDATION_ERROR')
  })
})

