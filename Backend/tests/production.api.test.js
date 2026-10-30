const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('./helpers/appTestUtils')

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-backend-suite'
const userId = '11111111-1111-4111-8111-111111111111'

function createToken(role = 'Admin') {
  return jwt.sign(
    {
      username: role.toLowerCase().replaceAll(' ', ''),
      role,
    },
    JWT_SECRET,
    { subject: userId, expiresIn: '1h' },
  )
}

function authHeader(role = 'Admin') {
  return {
    Authorization: `Bearer ${createToken(role)}`,
  }
}

const mockOutputSensor = {
  id: '33333333-3333-4333-8333-555555555555',
  sensor_code: 'S-05',
  label: 'Spiral Pipe Exit Sensor',
  machine_id: '22222222-2222-4222-8222-222222222222',
  machines: {
    id: '22222222-2222-4222-8222-222222222222',
    machine_code: 'M-01',
    name: 'Spiral Mill 01',
  },
}

const sampleEvents = [
  {
    id: 'e0000000-0000-0000-0000-000000000001',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-001',
    event_type: 'pulse',
    recorded_at: '2026-03-15T08:00:00.000Z',
    output_accepted: true,
    output_rejection_reason: null,
  },
  {
    id: 'e0000000-0000-0000-0000-000000000002',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-002',
    event_type: 'pulse',
    recorded_at: '2026-03-15T09:00:00.000Z',
    output_accepted: true,
    output_rejection_reason: null,
  },
  {
    id: 'e0000000-0000-0000-0000-000000000003',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-003',
    event_type: 'pulse',
    recorded_at: '2026-03-15T10:00:00.000Z',
    output_accepted: false,
    output_rejection_reason: 'Debounce window violated.',
  },
  {
    id: 'e0000000-0000-0000-0000-000000000004',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-004',
    event_type: 'pulse',
    recorded_at: '2026-03-15T11:00:00.000Z',
    output_accepted: true,
    output_rejection_reason: null,
  },
  {
    id: 'e0000000-0000-0000-0000-000000000005',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-005',
    event_type: 'pulse',
    recorded_at: '2026-03-15T12:00:00.000Z',
    output_accepted: null,
    output_rejection_reason: null,
  },
]

const sampleSpecsMap = new Map([
  [
    'e0000000-0000-0000-0000-000000000001',
    {
      sensor_event_id: 'e0000000-0000-0000-0000-000000000001',
      label: 'Batch Alpha Pipe',
      size: '12 inch',
      diameter: '12.50',
      radius: '6.25',
      circumference: '39.27',
      updated_at: '2026-03-15T08:30:00.000Z',
      updated_by: userId,
    },
  ],
])

function createMockRepository(overrides = {}) {
  return {
    findOutputSensor: async () => mockOutputSensor,
    findProductionEvents: async () => sampleEvents,
    findProductionSpecsByEventIds: async (ids) => {
      const map = new Map()
      ids.forEach((id) => {
        if (sampleSpecsMap.has(id)) {
          map.set(id, sampleSpecsMap.get(id))
        }
      })
      return map
    },
    ...overrides,
  }
}

test('GET /api/production returns 401 when unauthenticated', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production')
    assert.equal(response.status, 401)
    assertError(body, 'UNAUTHENTICATED')
  })
})

test('GET /api/production allows all 5 view roles and denies unauthorized roles', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  const authorizedRoles = [
    'Admin',
    'Operation Manager',
    'Asst. Operation Manager',
    'Engineering Supervisor',
    'Production Supervisor',
  ]

  await withTestServer(app, async (baseUrl) => {
    for (const role of authorizedRoles) {
      const { response, body } = await requestJson(baseUrl, '/api/production?date=2026-03-15', {
        headers: authHeader(role),
      })
      assert.equal(response.status, 200, `Role ${role} should be allowed`)
      assert.ok(body.records)
    }

    const unauthorized = await requestJson(baseUrl, '/api/production?date=2026-03-15', {
      headers: authHeader('Operator'),
    })
    assert.equal(unauthorized.response.status, 403)
    assertError(unauthorized.body, 'FORBIDDEN')
  })
})

test('GET /api/production default query returns accepted S-05 records only, merges specs, computes KPIs, sets no-store', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production?date=2026-03-15', {
      headers: authHeader('Admin'),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')

    assert.equal(body.sensor.code, 'S-05')
    assert.equal(body.sensor.label, 'Production Output Cutting')
    assert.equal(body.machine.code, 'M-01')
    assert.equal(body.machine.name, 'Spiral Mill 01')

    assert.equal(body.summary.totalAccepted, 3)
    assert.equal(body.summary.specifiedCount, 1)
    assert.equal(body.summary.unspecifiedCount, 2)
    assert.equal(body.summary.rejectedCount, 1)

    assert.equal(body.records.length, 3)
    body.records.forEach((record) => {
      assert.equal(record.status, 'accepted')
      assert.equal(record.outputAccepted, true)
      assert.equal(record.sensorCode, 'S-05')
      assert.equal(record.sensorLabel, 'Production Output Cutting')
    })

    const specifiedRecord = body.records.find((r) => r.id === 'e0000000-0000-0000-0000-000000000001')
    assert.ok(specifiedRecord)
    assert.equal(specifiedRecord.label, 'Batch Alpha Pipe')
    assert.equal(specifiedRecord.size, '12 inch')
    assert.equal(specifiedRecord.diameter, 12.5)
    assert.equal(specifiedRecord.radius, 6.25)
    assert.equal(specifiedRecord.circumference, 39.27)
    assert.equal(specifiedRecord.isSpecified, true)
    assert.equal(specifiedRecord.specStatus, 'specified')
    assert.equal(specifiedRecord.isEditable, true)

    const unspecifiedRecord = body.records.find((r) => r.id === 'e0000000-0000-0000-0000-000000000002')
    assert.ok(unspecifiedRecord)
    assert.equal(unspecifiedRecord.label, null)
    assert.equal(unspecifiedRecord.isSpecified, false)
    assert.equal(unspecifiedRecord.specStatus, 'unspecified')
    assert.equal(unspecifiedRecord.isEditable, true)
  })
})

test('GET /api/production filters by status, specStatus, and search', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const rejectedRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&status=rejected', {
      headers: authHeader('Admin'),
    })
    assert.equal(rejectedRes.response.status, 200)
    assert.equal(rejectedRes.body.records.length, 1)
    assert.equal(rejectedRes.body.records[0].status, 'rejected')
    assert.equal(rejectedRes.body.records[0].outputAccepted, false)
    assert.equal(rejectedRes.body.records[0].rejectionReason, 'Debounce window violated.')
    assert.equal(rejectedRes.body.records[0].specStatus, 'rejected')
    assert.equal(rejectedRes.body.records[0].isEditable, false)

    const allStatusRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&status=all', {
      headers: authHeader('Admin'),
    })
    assert.equal(allStatusRes.response.status, 200)
    assert.equal(allStatusRes.body.records.length, 4)
    assert.equal(
      allStatusRes.body.records.find((r) => r.id === 'e0000000-0000-0000-0000-000000000005'),
      undefined,
      'Null output_accepted events should be excluded',
    )

    const specifiedRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&specStatus=specified', {
      headers: authHeader('Admin'),
    })
    assert.equal(specifiedRes.response.status, 200)
    assert.equal(specifiedRes.body.records.length, 1)
    assert.equal(specifiedRes.body.records[0].id, 'e0000000-0000-0000-0000-000000000001')

    const unspecifiedRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&specStatus=unspecified', {
      headers: authHeader('Admin'),
    })
    assert.equal(unspecifiedRes.response.status, 200)
    assert.equal(unspecifiedRes.body.records.length, 2)

    const searchRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=alpha', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchRes.response.status, 200)
    assert.equal(searchRes.body.records.length, 1)
    assert.equal(searchRes.body.records[0].label, 'Batch Alpha Pipe')
  })
})

test('GET /api/production supports pagination with page and pageSize/limit', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const page1 = await requestJson(baseUrl, '/api/production?date=2026-03-15&page=1&pageSize=2', {
      headers: authHeader('Admin'),
    })
    assert.equal(page1.response.status, 200)
    assert.equal(page1.body.records.length, 2)
    assert.deepEqual(page1.body.pagination, {
      page: 1,
      pageSize: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    })

    const page2 = await requestJson(baseUrl, '/api/production?date=2026-03-15&page=2&pageSize=2', {
      headers: authHeader('Admin'),
    })
    assert.equal(page2.response.status, 200)
    assert.equal(page2.body.records.length, 1)
    assert.deepEqual(page2.body.pagination, {
      page: 2,
      pageSize: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    })

    const limitAlias = await requestJson(baseUrl, '/api/production?date=2026-03-15&limit=1', {
      headers: authHeader('Admin'),
    })
    assert.equal(limitAlias.response.status, 200)
    assert.equal(limitAlias.body.records.length, 1)
    assert.equal(limitAlias.body.pagination.pageSize, 1)
    assert.equal(limitAlias.body.pagination.limit, 1)
  })
})

test('GET /api/production handles future date with periodState: future and null KPIs', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const singleDate = await requestJson(baseUrl, '/api/production?date=2099-01-01', {
      headers: authHeader('Admin'),
    })

    assert.equal(singleDate.response.status, 200)
    assert.equal(singleDate.body.periodState, 'future')
    assert.deepEqual(singleDate.body.records, [])
    assert.deepEqual(singleDate.body.summary, {
      totalAcceptedToday: null,
      totalAccepted: null,
      specifiedCount: null,
      unspecifiedCount: null,
      rejectedCount: null,
    })
    assert.equal(singleDate.body.pagination.total, 0)
    assert.equal(singleDate.body.pagination.totalPages, 1)
    assert.equal(singleDate.body.pagination.limit, 25)

    const openFuture = await requestJson(baseUrl, '/api/production?dateFrom=2099-01-01', {
      headers: authHeader('Admin'),
    })
    assert.equal(openFuture.response.status, 200)
    assert.equal(openFuture.body.periodState, 'future')
  })
})

test('GET /api/production handles open-ended dateTo with valid 30-day window', async () => {
  const queriedWindows = []
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      findProductionEvents: async (params) => {
        queriedWindows.push(params)
        return []
      },
    }),
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production?dateTo=2020-01-01', {
      headers: authHeader('Admin'),
    })

    assert.equal(response.status, 200)
    assert.equal(body.periodState, 'complete')
    assert.equal(body.range.end, '2020-01-01T16:00:00.000Z')
    assert.equal(body.range.start, '2019-12-02T16:00:00.000Z')
    assert.ok(queriedWindows.length >= 1)
    assert.equal(queriedWindows[0].endIso, '2020-01-01T16:00:00.000Z')
    assert.equal(queriedWindows[0].startIso, '2019-12-02T16:00:00.000Z')
  })
})

test('GET /api/production returns 400 VALIDATION_ERROR on invalid parameters', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const invalidPage = await requestJson(baseUrl, '/api/production?page=0', {
      headers: authHeader('Admin'),
    })
    assert.equal(invalidPage.response.status, 400)
    assertError(invalidPage.body, 'VALIDATION_ERROR')

    const invalidPageSize = await requestJson(baseUrl, '/api/production?pageSize=101', {
      headers: authHeader('Admin'),
    })
    assert.equal(invalidPageSize.response.status, 400)
    assertError(invalidPageSize.body, 'VALIDATION_ERROR')

    const invalidStatus = await requestJson(baseUrl, '/api/production?status=unknown', {
      headers: authHeader('Admin'),
    })
    assert.equal(invalidStatus.response.status, 400)
    assertError(invalidStatus.body, 'VALIDATION_ERROR')

    const invalidDateRange = await requestJson(baseUrl, '/api/production?dateFrom=2026-03-20&dateTo=2026-03-10', {
      headers: authHeader('Admin'),
    })
    assert.equal(invalidDateRange.response.status, 400)
    assertError(invalidDateRange.body, 'VALIDATION_ERROR')

    const dateRangeExceeding366 = await requestJson(baseUrl, '/api/production?dateFrom=2025-01-01&dateTo=2026-06-01', {
      headers: authHeader('Admin'),
    })
    assert.equal(dateRangeExceeding366.response.status, 400)
    assertError(dateRangeExceeding366.body, 'VALIDATION_ERROR')

    const combinedDateAndRange = await requestJson(baseUrl, '/api/production?date=2026-03-15&dateFrom=2026-03-10', {
      headers: authHeader('Admin'),
    })
    assert.equal(combinedDateAndRange.response.status, 400)
    assertError(combinedDateAndRange.body, 'VALIDATION_ERROR')

    const unknownParam = await requestJson(baseUrl, '/api/production?extraField=injected', {
      headers: authHeader('Admin'),
    })
    assert.equal(unknownParam.response.status, 400)
    assertError(unknownParam.body, 'VALIDATION_ERROR')
  })
})

test('GET /api/production returns safe 500 when repository fails or sensor is missing', async () => {
  const failingQueryApp = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      findProductionEvents: async () => {
        const error = new Error('Database raw connection failed: timeout on port 5432')
        error.status = 500
        error.code = 'PRODUCTION_QUERY_FAILED'
        throw error
      },
    }),
  })

  await withTestServer(failingQueryApp, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production?date=2026-03-15', {
      headers: authHeader('Admin'),
    })

    assert.equal(response.status, 500)
    assert.equal(body?.error?.code, 'PRODUCTION_QUERY_FAILED')
    assert.equal(body?.error?.message, 'Unexpected server error.')
    assert.equal(body?.error?.details, undefined)
  })

  const missingSensorApp = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      findOutputSensor: async () => null,
    }),
  })

  await withTestServer(missingSensorApp, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production?date=2026-03-15', {
      headers: authHeader('Admin'),
    })

    assert.equal(response.status, 500)
    assert.equal(body?.error?.code, 'PRODUCTION_SENSOR_MISSING')
    assert.equal(body?.error?.message, 'Unexpected server error.')
  })
})
