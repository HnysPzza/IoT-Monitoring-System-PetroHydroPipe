const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const {
  assertError,
  loadAppWithMocks,
  requestJson,
  withTestServer,
} = require('../../helpers/appTestUtils')

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
    id: 'e0000000-0000-4000-8000-000000000001',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-001',
    event_type: 'pulse',
    recorded_at: '2026-03-15T08:00:00.000Z',
    output_accepted: true,
    output_rejection_reason: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000002',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-002',
    event_type: 'pulse',
    recorded_at: '2026-03-15T09:00:00.000Z',
    output_accepted: true,
    output_rejection_reason: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000003',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-003',
    event_type: 'pulse',
    recorded_at: '2026-03-15T10:00:00.000Z',
    output_accepted: false,
    output_rejection_reason: 'Debounce window violated.',
  },
  {
    id: 'e0000000-0000-4000-8000-000000000004',
    sensor_id: mockOutputSensor.id,
    machine_id: mockOutputSensor.machine_id,
    device_event_id: 'dev-evt-004',
    event_type: 'pulse',
    recorded_at: '2026-03-15T11:00:00.000Z',
    output_accepted: true,
    output_rejection_reason: null,
  },
  {
    id: 'e0000000-0000-4000-8000-000000000005',
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
    'e0000000-0000-4000-8000-000000000001',
    {
      sensor_event_id: 'e0000000-0000-4000-8000-000000000001',
      customer: 'MCWD',
      diameter: '625.40',
      thickness: '12.70',
      length: '6000.00',
      pipe_number: 101,
      label: 'Batch Alpha Pipe',
      size: '12 inch',
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
    updateProductionSpec: async (params) => ({
      sensor_event_id: params.eventId,
      customer: params.customer ?? null,
      diameter: params.diameter != null ? String(params.diameter) : null,
      thickness: params.thickness != null ? String(params.thickness) : null,
      length: params.length != null ? String(params.length) : null,
      pipe_number: params.pipeNumber != null ? params.pipeNumber : null,
      label: params.label ?? null,
      size: params.size ?? null,
      radius: params.radius != null ? String(params.radius) : null,
      circumference: params.circumference != null ? String(params.circumference) : null,
      updated_at: '2026-03-15T09:00:00.000Z',
      updated_by: params.actorUserId,
    }),
    batchUpdateProductionSpecs: async (params) => ({
      matched_count: params.sensorEventIds ? params.sensorEventIds.length : 5,
      updated_count: params.sensorEventIds ? params.sensorEventIds.length : 5,
      sensor_event_ids: params.sensorEventIds || ['e0000000-0000-4000-8000-000000000001'],
    }),
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
    'Quality Control',
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
    assert.equal(body.summary.totalTonnage, 1.1513)

    assert.equal(body.records.length, 3)
    body.records.forEach((record) => {
      assert.equal(record.status, 'accepted')
      assert.equal(record.outputAccepted, true)
      assert.equal(record.sensorCode, 'S-05')
      assert.equal(record.sensorLabel, 'Production Output Cutting')
    })

    const specifiedRecord = body.records.find((r) => r.id === 'e0000000-0000-4000-8000-000000000001')
    assert.ok(specifiedRecord)
    assert.equal(specifiedRecord.customer, 'MCWD')
    assert.equal(specifiedRecord.diameter, 625.4)
    assert.equal(specifiedRecord.thickness, 12.7)
    assert.equal(specifiedRecord.length, 6000)
    assert.equal(specifiedRecord.pipeNumber, 101)
    assert.equal(specifiedRecord.tonnage, 1.1513)
    assert.equal(specifiedRecord.label, 'Batch Alpha Pipe')
    assert.equal(specifiedRecord.size, '12 inch')
    assert.equal(specifiedRecord.radius, 6.25)
    assert.equal(specifiedRecord.circumference, 39.27)
    assert.equal(specifiedRecord.isSpecified, true)
    assert.equal(specifiedRecord.specStatus, 'specified')
    assert.equal(specifiedRecord.isEditable, true)

    const unspecifiedRecord = body.records.find((r) => r.id === 'e0000000-0000-4000-8000-000000000002')
    assert.ok(unspecifiedRecord)
    assert.equal(unspecifiedRecord.customer, null)
    assert.equal(unspecifiedRecord.diameter, null)
    assert.equal(unspecifiedRecord.thickness, null)
    assert.equal(unspecifiedRecord.length, null)
    assert.equal(unspecifiedRecord.pipeNumber, 2)
    assert.equal(unspecifiedRecord.tonnage, null)
    assert.equal(unspecifiedRecord.label, null)
    assert.equal(unspecifiedRecord.isSpecified, false)
    assert.equal(unspecifiedRecord.specStatus, 'unspecified')
    assert.equal(unspecifiedRecord.isEditable, true)

    const thirdAcceptedRecord = body.records.find((r) => r.id === 'e0000000-0000-4000-8000-000000000004')
    assert.ok(thirdAcceptedRecord)
    assert.equal(thirdAcceptedRecord.pipeNumber, 3)
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
      allStatusRes.body.records.find((r) => r.id === 'e0000000-0000-4000-8000-000000000005'),
      undefined,
      'Null output_accepted events should be excluded',
    )

    const specifiedRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&specStatus=specified', {
      headers: authHeader('Admin'),
    })
    assert.equal(specifiedRes.response.status, 200)
    assert.equal(specifiedRes.body.records.length, 1)
    assert.equal(specifiedRes.body.records[0].id, 'e0000000-0000-4000-8000-000000000001')

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

    const searchCustomerRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=mcwd', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchCustomerRes.response.status, 200)
    assert.equal(searchCustomerRes.body.records.length, 1)
    assert.equal(searchCustomerRes.body.records[0].customer, 'MCWD')

    const searchPipeNumRes = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=101', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchPipeNumRes.response.status, 200)
    assert.equal(searchPipeNumRes.body.records.length, 1)
    assert.equal(searchPipeNumRes.body.records[0].pipeNumber, 101)
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
      totalTonnage: null,
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

test('PATCH /api/production/:eventId and /batch return 401 when unauthenticated', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const singleRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      body: { label: 'New Label' },
    })
    assert.equal(singleRes.response.status, 401)
    assertError(singleRes.body, 'UNAUTHENTICATED')

    const batchRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        label: 'Batch Label',
      },
    })
    assert.equal(batchRes.response.status, 401)
    assertError(batchRes.body, 'UNAUTHENTICATED')
  })
})

test('PATCH /api/production/:eventId enforces role matrix (Admin, Operation Manager, Production Supervisor only)', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  const allowedRoles = ['Admin', 'Operation Manager', 'Production Supervisor', 'Quality Control']
  const forbiddenRoles = ['Engineering Supervisor', 'Operator']

  await withTestServer(app, async (baseUrl) => {
    for (const role of allowedRoles) {
      const { response, body } = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
        method: 'PATCH',
        headers: authHeader(role),
        body: { label: `Spec by ${role}` },
      })
      assert.equal(response.status, 200, `Role ${role} should be allowed`)
      assert.ok(body.spec)
    }

    for (const role of forbiddenRoles) {
      const { response, body } = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
        method: 'PATCH',
        headers: authHeader(role),
        body: { label: 'Denied' },
      })
      assert.equal(response.status, 403, `Role ${role} should be forbidden`)
      assertError(body, 'FORBIDDEN')
    }
  })
})

test('PATCH /api/production/batch enforces role matrix', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  const allowedRoles = ['Admin', 'Operation Manager', 'Production Supervisor', 'Quality Control']
  const forbiddenRoles = ['Engineering Supervisor', 'Operator']

  await withTestServer(app, async (baseUrl) => {
    for (const role of allowedRoles) {
      const { response, body } = await requestJson(baseUrl, '/api/production/batch', {
        method: 'PATCH',
        headers: authHeader(role),
        body: {
          sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
          label: `Batch by ${role}`,
        },
      })
      assert.equal(response.status, 200, `Role ${role} should be allowed`)
      assert.equal(typeof body.updatedCount, 'number')
    }

    for (const role of forbiddenRoles) {
      const { response, body } = await requestJson(baseUrl, '/api/production/batch', {
        method: 'PATCH',
        headers: authHeader(role),
        body: {
          sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
          label: 'Batch Denied',
        },
      })
      assert.equal(response.status, 403, `Role ${role} should be forbidden`)
      assertError(body, 'FORBIDDEN')
    }
  })
})

test('Route precedence: PATCH /api/production/batch is routed to batch handler before /:eventId', async () => {
  let calledEndpoint = null
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      updateProductionSpec: async () => {
        calledEndpoint = 'single'
        return {}
      },
      batchUpdateProductionSpecs: async () => {
        calledEndpoint = 'batch'
        return {
          matched_count: 1,
          updated_count: 1,
          sensor_event_ids: ['e0000000-0000-4000-8000-000000000001'],
        }
      },
    }),
  })

  await withTestServer(app, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        label: 'Precedence Check',
      },
    })

    assert.equal(response.status, 200)
    assert.equal(calledEndpoint, 'batch')
    assert.equal(body.updatedCount, 1)
  })
})

test('PATCH /api/production/:eventId updates spec, sets no-store, normalizes blanks to null, and supports idempotent retry', async () => {
  let capturedUpdateParams = null
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      updateProductionSpec: async (params) => {
        capturedUpdateParams = params
        return {
          sensor_event_id: params.eventId,
          customer: params.customer,
          diameter: params.diameter != null ? String(params.diameter) : null,
          thickness: params.thickness != null ? String(params.thickness) : null,
          length: params.length != null ? String(params.length) : null,
          pipe_number: params.pipeNumber != null ? params.pipeNumber : null,
          label: null,
          size: null,
          radius: null,
          circumference: null,
          updated_at: '2026-03-15T12:00:00.000Z',
          updated_by: params.actorUserId,
        }
      },
    }),
  })

  await withTestServer(app, async (baseUrl) => {
    const validRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        customer: '  MCWD  ',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: '101',
        expectedUpdatedAt: '2026-03-15T08:30:00.000Z',
      },
    })

    assert.equal(validRes.response.status, 200)
    assert.equal(validRes.response.headers.get('cache-control'), 'no-store')
    assert.equal(capturedUpdateParams.eventId, 'e0000000-0000-4000-8000-000000000001')
    assert.equal(capturedUpdateParams.customer, 'MCWD')
    assert.equal(capturedUpdateParams.diameter, 625.4)
    assert.equal(capturedUpdateParams.thickness, 12.7)
    assert.equal(capturedUpdateParams.length, 6000)
    assert.equal(capturedUpdateParams.pipeNumber, 101)
    assert.equal(capturedUpdateParams.actorUserId, userId)
    assert.equal(capturedUpdateParams.expectedUpdatedAt, '2026-03-15T08:30:00.000Z')

    assert.deepEqual(validRes.body, {
      spec: {
        sensorEventId: 'e0000000-0000-4000-8000-000000000001',
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 101,
        tonnage: 1.1513,
        label: null,
        size: null,
        radius: null,
        circumference: null,
        isSpecified: true,
        specStatus: 'specified',
        updatedAt: '2026-03-15T12:00:00.000Z',
        updatedBy: userId,
      },
    })

    const retryRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 101,
        expectedUpdatedAt: '2026-03-15T08:30:00.000Z',
      },
    })
    assert.equal(retryRes.response.status, 200)
    assert.equal(retryRes.body.spec.customer, 'MCWD')
    assert.equal(retryRes.body.spec.tonnage, 1.1513)

    const clearRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        customer: '   ',
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
      },
    })

    assert.equal(clearRes.response.status, 200)
    assert.equal(capturedUpdateParams.customer, null)
    assert.equal(capturedUpdateParams.diameter, null)
    assert.equal(capturedUpdateParams.thickness, null)
    assert.equal(capturedUpdateParams.length, null)
    assert.equal(capturedUpdateParams.pipeNumber, null)
    assert.deepEqual(clearRes.body, {
      spec: {
        sensorEventId: 'e0000000-0000-4000-8000-000000000001',
        customer: null,
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
        tonnage: null,
        label: null,
        size: null,
        radius: null,
        circumference: null,
        isSpecified: false,
        specStatus: 'unspecified',
        updatedAt: '2026-03-15T12:00:00.000Z',
        updatedBy: userId,
      },
    })
  })
})

test('Error mapping on PATCH /api/production/:eventId and /batch maps RPC error codes', async () => {
  function makeError(code, message, status = 500) {
    const error = new Error(message)
    error.code = code
    error.status = status
    return error
  }

  const notFoundApp = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      updateProductionSpec: async () => {
        throw makeError('PRODUCTION_RECORD_NOT_FOUND', 'Production log record not found.', 404)
      },
    }),
  })
  await withTestServer(notFoundApp, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { label: 'New' },
    })
    assert.equal(response.status, 404)
    assertError(body, 'PRODUCTION_RECORD_NOT_FOUND')
    assert.equal(body.error.message, 'Production log record not found.')
  })

  const invalidApp = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      updateProductionSpec: async () => {
        throw makeError('PRODUCTION_SPEC_INVALID', 'Production specification cannot be updated for rejected output events.', 400)
      },
    }),
  })
  await withTestServer(invalidApp, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { label: 'New' },
    })
    assert.equal(response.status, 400)
    assertError(body, 'PRODUCTION_SPEC_INVALID')
    assert.equal(body.error.message, 'Production specification cannot be updated for rejected output events.')
  })

  const conflictApp = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      updateProductionSpec: async () => {
        throw makeError('PRODUCTION_SPEC_CONFLICT', 'Production specification was modified by another user.', 409)
      },
    }),
  })
  await withTestServer(conflictApp, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { label: 'New', expectedUpdatedAt: '2026-03-15T08:00:00.000Z' },
    })
    assert.equal(response.status, 409)
    assertError(body, 'PRODUCTION_SPEC_CONFLICT')
    assert.equal(body.error.message, 'Production specification was modified by another user.')
  })

  const serverErrorApp = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      batchUpdateProductionSpecs: async () => {
        throw makeError('PRODUCTION_BATCH_UPDATE_FAILED', 'Raw connection drop on internal port', 500)
      },
    }),
  })
  await withTestServer(serverErrorApp, async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        label: 'Batch Spec',
      },
    })
    assert.equal(response.status, 500)
    assertError(body, 'PRODUCTION_BATCH_UPDATE_FAILED')
    assert.equal(body.error.message, 'Unexpected server error.')
  })
})

test('PATCH /api/production/batch supports ID array, ISO range, and date range filters with onlyUnlabeled', async () => {
  let capturedBatchParams = null
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository({
      batchUpdateProductionSpecs: async (params) => {
        capturedBatchParams = params
        return {
          matched_count: 2,
          updated_count: 2,
          sensor_event_ids: params.sensorEventIds || [
            'e0000000-0000-4000-8000-000000000001',
            'e0000000-0000-4000-8000-000000000002',
          ],
        }
      },
    }),
  })

  await withTestServer(app, async (baseUrl) => {
    const idsRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: [
          'e0000000-0000-4000-8000-000000000001',
          'e0000000-0000-4000-8000-000000000002',
        ],
        customer: 'MCWD',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
      },
    })
    assert.equal(idsRes.response.status, 200)
    assert.equal(idsRes.response.headers.get('cache-control'), 'no-store')
    assert.equal(idsRes.body.matchedCount, 2)
    assert.equal(idsRes.body.updatedCount, 2)
    assert.deepEqual(capturedBatchParams.sensorEventIds, [
      'e0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000002',
    ])
    assert.equal(capturedBatchParams.startedAt, null)
    assert.equal(capturedBatchParams.endedAt, null)
    assert.equal(capturedBatchParams.onlyUnlabeled, false)
    assert.equal(capturedBatchParams.customer, 'MCWD')
    assert.equal(capturedBatchParams.diameter, 625.4)
    assert.equal(capturedBatchParams.thickness, 12.7)
    assert.equal(capturedBatchParams.length, 6000)
    assert.equal(capturedBatchParams.actorUserId, userId)

    const isoRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        startedAt: '2026-03-15T00:00:00.000Z',
        endedAt: '2026-03-15T12:00:00.000Z',
        onlyUnlabeled: true,
        customer: 'Batch Customer',
      },
    })
    assert.equal(isoRes.response.status, 200)
    assert.equal(capturedBatchParams.sensorEventIds, null)
    assert.equal(capturedBatchParams.startedAt, '2026-03-15T00:00:00.000Z')
    assert.equal(capturedBatchParams.endedAt, '2026-03-15T12:00:00.000Z')
    assert.equal(capturedBatchParams.onlyUnlabeled, true)
    assert.equal(capturedBatchParams.customer, 'Batch Customer')

    const dateRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        dateFrom: '2026-03-10',
        dateTo: '2026-03-15',
        onlyUnlabeled: false,
        diameter: 1020.0,
      },
    })
    assert.equal(dateRes.response.status, 200)
    assert.equal(capturedBatchParams.sensorEventIds, null)
    assert.equal(capturedBatchParams.startedAt, '2026-03-09T16:00:00.000Z')
    assert.equal(capturedBatchParams.endedAt, '2026-03-15T16:00:00.000Z')
    assert.equal(capturedBatchParams.diameter, 1020.0)
  })
})

test('Validation rejects invalid payloads on PATCH /api/production/:eventId and /batch', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepository(),
  })

  await withTestServer(app, async (baseUrl) => {
    const invalidIdRes = await requestJson(baseUrl, '/api/production/not-a-uuid', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { label: 'Valid Label' },
    })
    assert.equal(invalidIdRes.response.status, 400)
    assertError(invalidIdRes.body, 'VALIDATION_ERROR')

    const extraFieldSingle = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { label: 'Valid Label', maliciousField: true },
    })
    assert.equal(extraFieldSingle.response.status, 400)
    assertError(extraFieldSingle.body, 'VALIDATION_ERROR')

    const zeroDimRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { diameter: 0 },
    })
    assert.equal(zeroDimRes.response.status, 400)
    assertError(zeroDimRes.body, 'VALIDATION_ERROR')

    const negativeDimRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { radius: -5 },
    })
    assert.equal(negativeDimRes.response.status, 400)
    assertError(negativeDimRes.body, 'VALIDATION_ERROR')

    const roundedToZeroRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { diameter: 0.001 },
    })
    assert.equal(roundedToZeroRes.response.status, 400)
    assertError(roundedToZeroRes.body, 'VALIDATION_ERROR')

    const booleanDimRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { diameter: true },
    })
    assert.equal(booleanDimRes.response.status, 400)
    assertError(booleanDimRes.body, 'VALIDATION_ERROR')

    const arrayDimRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { diameter: [12.5] },
    })
    assert.equal(arrayDimRes.response.status, 400)
    assertError(arrayDimRes.body, 'VALIDATION_ERROR')

    const emptyBatchRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {},
    })
    assert.equal(emptyBatchRes.response.status, 400)
    assertError(emptyBatchRes.body, 'VALIDATION_ERROR')

    const bothTargetRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        startedAt: '2026-03-15T00:00:00.000Z',
        endedAt: '2026-03-15T12:00:00.000Z',
        label: 'Both Targets',
      },
    })
    assert.equal(bothTargetRes.response.status, 400)
    assertError(bothTargetRes.body, 'VALIDATION_ERROR')

    const partialRangeRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        startedAt: '2026-03-15T00:00:00.000Z',
        label: 'Missing endedAt',
      },
    })
    assert.equal(partialRangeRes.response.status, 400)
    assertError(partialRangeRes.body, 'VALIDATION_ERROR')

    const reversedIsoRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        startedAt: '2026-03-15T12:00:00.000Z',
        endedAt: '2026-03-15T00:00:00.000Z',
        label: 'Reversed ISO',
      },
    })
    assert.equal(reversedIsoRes.response.status, 400)
    assertError(reversedIsoRes.body, 'VALIDATION_ERROR')

    const reversedDateRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        dateFrom: '2026-03-20',
        dateTo: '2026-03-10',
        label: 'Reversed Date',
      },
    })
    assert.equal(reversedDateRes.response.status, 400)
    assertError(reversedDateRes.body, 'VALIDATION_ERROR')

    const customerTooLongRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { customer: 'A'.repeat(101) },
    })
    assert.equal(customerTooLongRes.response.status, 400)
    assertError(customerTooLongRes.body, 'VALIDATION_ERROR')

    const zeroThicknessRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { thickness: 0 },
    })
    assert.equal(zeroThicknessRes.response.status, 400)
    assertError(zeroThicknessRes.body, 'VALIDATION_ERROR')

    const negativeThicknessRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { thickness: -1.5 },
    })
    assert.equal(negativeThicknessRes.response.status, 400)
    assertError(negativeThicknessRes.body, 'VALIDATION_ERROR')

    const zeroLengthRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { length: 0 },
    })
    assert.equal(zeroLengthRes.response.status, 400)
    assertError(zeroLengthRes.body, 'VALIDATION_ERROR')

    const zeroPipeNumRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { pipeNumber: 0 },
    })
    assert.equal(zeroPipeNumRes.response.status, 400)
    assertError(zeroPipeNumRes.body, 'VALIDATION_ERROR')

    const floatPipeNumRes = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { pipeNumber: 10.5 },
    })
    assert.equal(floatPipeNumRes.response.status, 400)
    assertError(floatPipeNumRes.body, 'VALIDATION_ERROR')

    const batchWithPipeNum = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        pipeNumber: 101,
      },
    })
    assert.equal(batchWithPipeNum.response.status, 400)
    assertError(batchWithPipeNum.body, 'VALIDATION_ERROR')

    const batchBlankCustomer = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        customer: '   ',
      },
    })
    assert.equal(batchBlankCustomer.response.status, 400)
    assertError(batchBlankCustomer.body, 'VALIDATION_ERROR')

    const noSpecFieldsRes = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        label: '   ',
      },
    })
    assert.equal(noSpecFieldsRes.response.status, 400)
    assertError(noSpecFieldsRes.body, 'VALIDATION_ERROR')

    const over500Ids = Array.from({ length: 501 }, (_, i) => {
      const hex = i.toString(16).padStart(12, '0')
      return `00000000-0000-4000-8000-${hex}`
    })
    const over500Res = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: over500Ids,
        label: 'Too Many Records',
      },
    })
    assert.equal(over500Res.response.status, 400)
    assertError(over500Res.body, 'VALIDATION_ERROR')
  })
})

test('productionRepository: updateProductionSpec and batchUpdateProductionSpecs RPC invocation and error mapping', async () => {
  delete require.cache[require.resolve('../../../src/modules/production/production.repository')]
  const productionRepository = require('../../../src/modules/production/production.repository')

  let calledRpc = null
  let calledParams = null

  const mockClient = {
    rpc: async (name, params) => {
      calledRpc = name
      calledParams = params
      return {
        data: [
          {
            sensor_event_id: params.p_sensor_event_id,
            customer: params.p_customer,
            diameter: params.p_diameter,
            thickness: params.p_thickness,
            length: params.p_length,
            pipe_number: params.p_pipe_number,
            label: null,
            size: null,
            radius: null,
            circumference: null,
            updated_at: '2026-03-15T12:00:00.000Z',
            updated_by: params.p_actor_user_id,
          },
        ],
        error: null,
      }
    },
  }

  const singleResult = await productionRepository.updateProductionSpec(
    {
      eventId: 'e0000000-0000-4000-8000-000000000001',
      customer: 'MCWD',
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeNumber: 101,
      actorUserId: userId,
      expectedUpdatedAt: '2026-03-15T08:00:00.000Z',
    },
    mockClient,
  )

  assert.equal(calledRpc, 'update_production_log_spec')
  assert.equal(calledParams.p_sensor_event_id, 'e0000000-0000-4000-8000-000000000001')
  assert.equal(calledParams.p_customer, 'MCWD')
  assert.equal(calledParams.p_diameter, 625.4)
  assert.equal(calledParams.p_thickness, 12.7)
  assert.equal(calledParams.p_length, 6000)
  assert.equal(calledParams.p_pipe_number, 101)
  assert.equal(calledParams.p_actor_user_id, userId)
  assert.equal(calledParams.p_expected_updated_at, '2026-03-15T08:00:00.000Z')
  assert.equal(singleResult.customer, 'MCWD')

  const batchMockClient = {
    rpc: async (name, params) => {
      calledRpc = name
      calledParams = params
      return {
        data: {
          matched_count: 3,
          updated_count: 3,
          sensor_event_ids: params.p_sensor_event_ids,
        },
        error: null,
      }
    },
  }

  const batchResult = await productionRepository.batchUpdateProductionSpecs(
    {
      sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
      startedAt: null,
      endedAt: null,
      onlyUnlabeled: true,
      customer: 'Batch Corp',
      diameter: 1020,
      thickness: 10,
      length: 12000,
      actorUserId: userId,
    },
    batchMockClient,
  )

  assert.equal(calledRpc, 'batch_update_production_log_specs')
  assert.deepEqual(calledParams.p_sensor_event_ids, ['e0000000-0000-4000-8000-000000000001'])
  assert.equal(calledParams.p_only_unlabeled, true)
  assert.equal(calledParams.p_customer, 'Batch Corp')
  assert.equal(calledParams.p_diameter, 1020)
  assert.equal(calledParams.p_thickness, 10)
  assert.equal(calledParams.p_length, 12000)
  assert.equal(batchResult.updated_count, 3)

  const errorCodes = [
    { code: 'P0002', expectedStatus: 404, expectedCode: 'PRODUCTION_RECORD_NOT_FOUND' },
    { code: '22023', expectedStatus: 400, expectedCode: 'PRODUCTION_SPEC_INVALID' },
    { code: '40001', expectedStatus: 409, expectedCode: 'PRODUCTION_SPEC_CONFLICT' },
    { code: 'XX000', expectedStatus: 500, expectedCode: 'PRODUCTION_SPEC_UPDATE_FAILED' },
  ]

  for (const { code, expectedStatus, expectedCode } of errorCodes) {
    const failingClient = {
      rpc: async () => ({
        data: null,
        error: { code, message: `Database error code ${code}` },
      }),
    }

    await assert.rejects(
      productionRepository.updateProductionSpec(
        { eventId: 'e0000000-0000-4000-8000-000000000001', actorUserId: userId },
        failingClient,
      ),
      (err) => {
        assert.equal(err.status, expectedStatus)
        assert.equal(err.code, expectedCode)
        return true
      },
    )
  }

  const emptyClient = {
    rpc: async () => ({
      data: [],
      error: null,
    }),
  }
  await assert.rejects(
    productionRepository.updateProductionSpec(
      { eventId: 'e0000000-0000-4000-8000-000000000001', actorUserId: userId },
      emptyClient,
    ),
    (err) => {
      assert.equal(err.status, 500)
      assert.equal(err.code, 'PRODUCTION_SPEC_UPDATE_FAILED')
      return true
    },
  )
})

test('calculatePipeTonnage pure helper computes metric tonnage correctly and handles boundary invariants', () => {
  const { calculatePipeTonnage } = require('../../../src/modules/production/production.service')

  // Reference MCWD case: OD 625.4, Thickness 12.7, Length 6000 -> 1.1513 tons
  const mcwdTons = calculatePipeTonnage(625.4, 12.7, 6000)
  assert.equal(mcwdTons, 1.1513)

  // String coerced inputs
  assert.equal(calculatePipeTonnage('625.4', '12.7', '6000'), 1.1513)
  assert.equal(calculatePipeTonnage('  625.4  ', ' 12.7 ', ' 6000 '), 1.1513)

  // Another real pipe spec: OD 1020, Thickness 10, Length 12000
  assert.equal(calculatePipeTonnage(1020, 10, 12000), 2.9888)

  // Invariant 1: Missing or blank inputs return null
  assert.equal(calculatePipeTonnage(null, 12.7, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, undefined, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 12.7, null), null)
  assert.equal(calculatePipeTonnage('', 12.7, 6000), null)
  assert.equal(calculatePipeTonnage('   ', 12.7, 6000), null)

  // Invariant 2: Non-finite inputs return null
  assert.equal(calculatePipeTonnage(NaN, 12.7, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, Infinity, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 12.7, -Infinity), null)
  assert.equal(calculatePipeTonnage('not-a-number', 12.7, 6000), null)

  // Invariant 3: Non-positive dimensions return null
  assert.equal(calculatePipeTonnage(0, 12.7, 6000), null)
  assert.equal(calculatePipeTonnage(-625.4, 12.7, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 0, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, -12.7, 6000), null)
  assert.equal(calculatePipeTonnage(625.4, 12.7, 0), null)
  assert.equal(calculatePipeTonnage(625.4, 12.7, -6000), null)

  // Invariant 4: OD <= Thickness returns null
  assert.equal(calculatePipeTonnage(12.7, 12.7, 6000), null)
  assert.equal(calculatePipeTonnage(10.0, 12.7, 6000), null)

  // Invariant 5: Invalid types (booleans, objects, arrays) return null
  assert.equal(calculatePipeTonnage(true, 12.7, 6000), null)
  assert.equal(calculatePipeTonnage([625.4], 12.7, 6000), null)
  assert.equal(calculatePipeTonnage({ od: 625.4 }, 12.7, 6000), null)
})

test('GET /api/production auto-numbers pipes sequentially per day and resets on next day', async () => {
  const multiDayEvents = [
    // Day 1: 2026-03-15
    {
      id: 'day1-evt-01',
      sensor_id: mockOutputSensor.id,
      machine_id: mockOutputSensor.machine_id,
      device_event_id: 'd1-01',
      event_type: 'pulse',
      recorded_at: '2026-03-15T00:30:00.000Z', // 08:30 Manila
      output_accepted: true,
      output_rejection_reason: null,
    },
    {
      id: 'day1-evt-02',
      sensor_id: mockOutputSensor.id,
      machine_id: mockOutputSensor.machine_id,
      device_event_id: 'd1-02',
      event_type: 'pulse',
      recorded_at: '2026-03-15T01:00:00.000Z', // 09:00 Manila (rejected)
      output_accepted: false,
      output_rejection_reason: 'Debounce window violated.',
    },
    {
      id: 'day1-evt-03',
      sensor_id: mockOutputSensor.id,
      machine_id: mockOutputSensor.machine_id,
      device_event_id: 'd1-03',
      event_type: 'pulse',
      recorded_at: '2026-03-15T02:00:00.000Z', // 10:00 Manila
      output_accepted: true,
      output_rejection_reason: null,
    },
    // Day 2: 2026-03-16
    {
      id: 'day2-evt-01',
      sensor_id: mockOutputSensor.id,
      machine_id: mockOutputSensor.machine_id,
      device_event_id: 'd2-01',
      event_type: 'pulse',
      recorded_at: '2026-03-16T00:15:00.000Z', // 08:15 Manila
      output_accepted: true,
      output_rejection_reason: null,
    },
    {
      id: 'day2-evt-02',
      sensor_id: mockOutputSensor.id,
      machine_id: mockOutputSensor.machine_id,
      device_event_id: 'd2-02',
      event_type: 'pulse',
      recorded_at: '2026-03-16T01:15:00.000Z', // 09:15 Manila
      output_accepted: true,
      output_rejection_reason: null,
    },
  ]

  const customRepo = createMockRepository({
    findProductionEvents: async () => multiDayEvents,
    findProductionSpecsByEventIds: async () => new Map(),
  })

  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': customRepo,
  })

  await withTestServer(app, async (baseUrl) => {
    const res = await requestJson(baseUrl, '/api/production?dateFrom=2026-03-15&dateTo=2026-03-16&status=all', {
      headers: authHeader('Admin'),
    })

    assert.equal(res.response.status, 200)
    const { records } = res.body

    const d1_01 = records.find((r) => r.id === 'day1-evt-01')
    const d1_02 = records.find((r) => r.id === 'day1-evt-02')
    const d1_03 = records.find((r) => r.id === 'day1-evt-03')
    const d2_01 = records.find((r) => r.id === 'day2-evt-01')
    const d2_02 = records.find((r) => r.id === 'day2-evt-02')

    // Day 1 first accepted cut -> pipe #1
    assert.equal(d1_01.pipeNumber, 1)
    // Day 1 rejected cut -> no pipe number
    assert.equal(d1_02.pipeNumber, null)
    // Day 1 second accepted cut -> pipe #2
    assert.equal(d1_03.pipeNumber, 2)

    // Day 2 first accepted cut resets to pipe #1
    assert.equal(d2_01.pipeNumber, 1)
    // Day 2 second accepted cut -> pipe #2
    assert.equal(d2_02.pipeNumber, 2)
  })
})

