const assert = require('node:assert/strict')
const test = require('node:test')
const jwt = require('jsonwebtoken')
const {
  customer,
  pipeNumber,
  dimension,
  updateProductionSpecBodySchema,
  batchUpdateBodySchema,
  listProductionLogsSchema,
} = require('../../../src/modules/production/production.model')
const {
  calculatePipeTonnage,
  toProductionRecord,
  toSpecPayload,
} = require('../../../src/modules/production/production.service')
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
    output_accepted: true,
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
      updated_at: '2026-03-15T08:30:00.000Z',
      updated_by: userId,
    },
  ],
  [
    'e0000000-0000-4000-8000-000000000002',
    {
      sensor_event_id: 'e0000000-0000-4000-8000-000000000002',
      customer: 'Regan Industrial',
      diameter: '1020.00',
      thickness: '10.00',
      length: '12000.00',
      pipe_number: 202,
      updated_at: '2026-03-15T09:30:00.000Z',
      updated_by: userId,
    },
  ],
])

function createMockRepo(overrides = {}) {
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
      label: null,
      size: null,
      radius: null,
      circumference: null,
      updated_at: '2026-03-15T12:00:00.000Z',
      updated_by: params.actorUserId,
    }),
    batchUpdateProductionSpecs: async (params) => ({
      matched_count: params.sensorEventIds ? params.sensorEventIds.length : 1,
      updated_count: params.sensorEventIds ? params.sensorEventIds.length : 1,
      sensor_event_ids: params.sensorEventIds || ['e0000000-0000-4000-8000-000000000001'],
    }),
    ...overrides,
  }
}

test('CHALLENGER STRESS: customer Zod schema unit verification', () => {
  // 1. Boundary: exactly 100 characters accepted
  const exactly100 = 'A'.repeat(100)
  assert.equal(customer.parse(exactly100), exactly100)

  // 2. Boundary: 101 characters rejected
  const exactly101 = 'A'.repeat(101)
  assert.throws(() => customer.parse(exactly101), /Customer name cannot exceed 100 characters/)

  // 3. Normalization: empty string becomes null
  assert.equal(customer.parse(''), null)

  // 4. Normalization: whitespace string becomes null
  assert.equal(customer.parse('   '), null)
  assert.equal(customer.parse('\t\n  \r'), null)

  // 5. Trimming: whitespace trimmed
  assert.equal(customer.parse('  MCWD  '), 'MCWD')

  // 6. Null and undefined
  assert.equal(customer.parse(null), null)
  assert.equal(customer.parse(undefined), undefined)

  // 7. Non-string types rejected
  assert.throws(() => customer.parse(123))
  assert.throws(() => customer.parse(true))
  assert.throws(() => customer.parse({}))
  assert.throws(() => customer.parse([]))
})

test('CHALLENGER STRESS: pipeNumber Zod schema unit verification', () => {
  // 1. Positive integers accepted
  assert.equal(pipeNumber.parse(1), 1)
  assert.equal(pipeNumber.parse(101), 101)
  assert.equal(pipeNumber.parse(999999), 999999)

  // 2. Coerced string positive integers
  assert.equal(pipeNumber.parse('101'), 101)
  assert.equal(pipeNumber.parse('  202  '), 202)

  // 3. Normalization: empty or whitespace string becomes null
  assert.equal(pipeNumber.parse(''), null)
  assert.equal(pipeNumber.parse('   '), null)

  // 4. Null and undefined
  assert.equal(pipeNumber.parse(null), null)
  assert.equal(pipeNumber.parse(undefined), undefined)

  // 5. Rejection: zero and negative numbers
  assert.throws(() => pipeNumber.parse(0), /Pipe number must be greater than zero/)
  assert.throws(() => pipeNumber.parse(-1), /Pipe number must be greater than zero/)
  assert.throws(() => pipeNumber.parse('0'), /Pipe number must be greater than zero/)
  assert.throws(() => pipeNumber.parse('-10'), /Pipe number must be greater than zero/)

  // 6. Rejection: non-integer floats
  assert.throws(() => pipeNumber.parse(10.5), /Pipe number must be an integer/)
  assert.throws(() => pipeNumber.parse('10.5'), /Pipe number must be an integer/)
  assert.throws(() => pipeNumber.parse(0.1), /Pipe number must be an integer/)

  // 7. Rejection: non-finite or invalid string
  assert.throws(() => pipeNumber.parse(NaN))
  assert.throws(() => pipeNumber.parse(Infinity))
  assert.throws(() => pipeNumber.parse(-Infinity))
  assert.throws(() => pipeNumber.parse('abc'))
  assert.throws(() => pipeNumber.parse('101abc'))

  // 8. Rejection: boolean, object, array
  assert.throws(() => pipeNumber.parse(true))
  assert.throws(() => pipeNumber.parse({}))
  assert.throws(() => pipeNumber.parse([101]))
})

test('CHALLENGER STRESS: dimension Zod schema unit verification', () => {
  // 1. Positive finite numbers accepted
  assert.equal(dimension.parse(625.4), 625.4)
  assert.equal(dimension.parse('625.4'), 625.4)
  assert.equal(dimension.parse('  12.7  '), 12.7)

  // 2. Upper limit: 99999999.99
  assert.equal(dimension.parse(99999999.99), 99999999.99)
  assert.throws(() => dimension.parse(100000000.00), /Dimension cannot exceed 99999999.99/)

  // 3. Precision lower boundary: rounding to 2 decimals must be > 0
  assert.equal(dimension.parse(0.01), 0.01)
  assert.equal(dimension.parse(0.005), 0.005) // rounds to 0.01
  assert.throws(() => dimension.parse(0.0049), /Dimension rounded to 2 decimal places must be greater than zero/)
  assert.throws(() => dimension.parse(0.001), /Dimension rounded to 2 decimal places must be greater than zero/)
  assert.throws(() => dimension.parse(0), /Dimension must be greater than zero/)
  assert.throws(() => dimension.parse(-10), /Dimension must be greater than zero/)

  // 4. Normalization of blank strings
  assert.equal(dimension.parse(''), null)
  assert.equal(dimension.parse('   '), null)

  // 5. Null and undefined
  assert.equal(dimension.parse(null), null)
  assert.equal(dimension.parse(undefined), undefined)

  // 6. Invalid non-numeric strings and non-finite
  assert.throws(() => dimension.parse('abc'))
  assert.throws(() => dimension.parse(NaN))
  assert.throws(() => dimension.parse(Infinity))
  assert.throws(() => dimension.parse(-Infinity))
  assert.throws(() => dimension.parse(true))
  assert.throws(() => dimension.parse([]))
  assert.throws(() => dimension.parse({}))
})

test('CHALLENGER STRESS: updateProductionSpecBodySchema refinement and strictness', () => {
  // 1. Empty body rejected
  assert.throws(
    () => updateProductionSpecBodySchema.parse({}),
    /Provide at least one specification field to update/,
  )

  // 2. Only expectedUpdatedAt without spec field rejected
  assert.throws(
    () => updateProductionSpecBodySchema.parse({ expectedUpdatedAt: '2026-03-15T08:00:00Z' }),
    /Provide at least one specification field to update/,
  )

  // 3. Unknown property rejected by .strict()
  assert.throws(
    () => updateProductionSpecBodySchema.parse({ customer: 'MCWD', hackerProp: 42 }),
  )

  // 4. Single valid spec fields pass
  assert.ok(updateProductionSpecBodySchema.parse({ customer: 'MCWD' }))
  assert.ok(updateProductionSpecBodySchema.parse({ diameter: 625.4 }))
  assert.ok(updateProductionSpecBodySchema.parse({ thickness: 12.7 }))
  assert.ok(updateProductionSpecBodySchema.parse({ length: 6000 }))
  assert.ok(updateProductionSpecBodySchema.parse({ pipeNumber: 101 }))

  // 5. Explicit clearing of field passes (customer: "   " preprocessed to null !== undefined)
  const cleared = updateProductionSpecBodySchema.parse({ customer: '   ' })
  assert.equal(cleared.customer, null)
})

test('CHALLENGER STRESS: batchUpdateBodySchema limits and mutual exclusivity', () => {
  const sampleUuid = 'e0000000-0000-4000-8000-000000000001'

  // 1. pipeNumber in batch payload is strictly rejected
  assert.throws(
    () => batchUpdateBodySchema.parse({
      sensorEventIds: [sampleUuid],
      pipeNumber: 101,
      customer: 'MCWD',
    }),
  )

  // 2. Exactly 500 sensorEventIds accepted
  const exactly500Ids = Array.from({ length: 500 }, (_, i) => {
    const hex = i.toString(16).padStart(12, '0')
    return `00000000-0000-4000-8000-${hex}`
  })
  const batch500 = batchUpdateBodySchema.parse({
    sensorEventIds: exactly500Ids,
    customer: 'Batch Corp',
  })
  assert.equal(batch500.sensorEventIds.length, 500)

  // 3. 501 sensorEventIds rejected
  const ids501 = Array.from({ length: 501 }, (_, i) => {
    const hex = i.toString(16).padStart(12, '0')
    return `00000000-0000-4000-8000-${hex}`
  })
  assert.throws(
    () => batchUpdateBodySchema.parse({
      sensorEventIds: ids501,
      customer: 'Batch Corp',
    }),
    /Batch specification update cannot exceed 500 records/,
  )

  // 4. 0 sensorEventIds rejected
  assert.throws(
    () => batchUpdateBodySchema.parse({
      sensorEventIds: [],
      customer: 'Batch Corp',
    }),
    /Select at least one production record/,
  )

  // 5. Mutual exclusivity violations
  // Case A: IDs and ISO range
  assert.throws(
    () => batchUpdateBodySchema.parse({
      sensorEventIds: [sampleUuid],
      startedAt: '2026-03-15T00:00:00Z',
      endedAt: '2026-03-15T12:00:00Z',
      customer: 'MCWD',
    }),
    /Provide either sensorEventIds or a valid time range, not both/,
  )

  // Case B: IDs and Date range
  assert.throws(
    () => batchUpdateBodySchema.parse({
      sensorEventIds: [sampleUuid],
      dateFrom: '2026-03-10',
      dateTo: '2026-03-15',
      customer: 'MCWD',
    }),
    /Provide either sensorEventIds or a valid time range, not both/,
  )

  // Case C: ISO range and Date range together
  assert.throws(
    () => batchUpdateBodySchema.parse({
      startedAt: '2026-03-15T00:00:00Z',
      endedAt: '2026-03-15T12:00:00Z',
      dateFrom: '2026-03-10',
      dateTo: '2026-03-15',
      customer: 'MCWD',
    }),
    /Provide either sensorEventIds or a valid time range, not both/,
  )

  // Case D: Incomplete range (only startedAt)
  assert.throws(
    () => batchUpdateBodySchema.parse({
      startedAt: '2026-03-15T00:00:00Z',
      customer: 'MCWD',
    }),
    /Provide either sensorEventIds or a valid time range, not both/,
  )

  // Case E: Incomplete range (only dateFrom)
  assert.throws(
    () => batchUpdateBodySchema.parse({
      dateFrom: '2026-03-10',
      customer: 'MCWD',
    }),
    /Provide either sensorEventIds or a valid time range, not both/,
  )

  // Case F: Neither IDs nor range
  assert.throws(
    () => batchUpdateBodySchema.parse({
      customer: 'MCWD',
    }),
    /Provide either sensorEventIds or a valid time range, not both/,
  )

  // 6. Chronological order violations
  // Case A: startedAt >= endedAt
  assert.throws(
    () => batchUpdateBodySchema.parse({
      startedAt: '2026-03-15T12:00:00Z',
      endedAt: '2026-03-15T08:00:00Z',
      customer: 'MCWD',
    }),
    /Start of range must be earlier than end of range/,
  )

  // Case B: dateFrom > dateTo
  assert.throws(
    () => batchUpdateBodySchema.parse({
      dateFrom: '2026-03-20',
      dateTo: '2026-03-10',
      customer: 'MCWD',
    }),
    /Start of range must be earlier than end of range/,
  )

  // Case C: Date range exceeding 366 days
  assert.throws(
    () => batchUpdateBodySchema.parse({
      dateFrom: '2025-01-01',
      dateTo: '2026-06-01',
      customer: 'MCWD',
    }),
    /Start of range must be earlier than end of range/,
  )

  // 7. No specification fields to apply (customer whitespace becomes null)
  assert.throws(
    () => batchUpdateBodySchema.parse({
      sensorEventIds: [sampleUuid],
      customer: '   ',
    }),
    /Provide at least one specification field to update/,
  )
})

test('CHALLENGER STRESS: API search filter and pagination integration', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepo(),
  })

  await withTestServer(app, async (baseUrl) => {
    // 1. Search by customer name lowercase 'mcwd'
    const searchMcwd = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=mcwd', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchMcwd.response.status, 200)
    assert.equal(searchMcwd.body.records.length, 1)
    assert.equal(searchMcwd.body.records[0].customer, 'MCWD')
    assert.equal(searchMcwd.body.records[0].pipeNumber, 101)

    // 2. Search by customer name uppercase 'REGAN'
    const searchRegan = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=REGAN', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchRegan.response.status, 200)
    assert.equal(searchRegan.body.records.length, 1)
    assert.equal(searchRegan.body.records[0].customer, 'Regan Industrial')
    assert.equal(searchRegan.body.records[0].pipeNumber, 202)

    // 3. Search by pipe serial number '101'
    const searchPipe101 = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=101', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchPipe101.response.status, 200)
    assert.equal(searchPipe101.body.records.length, 1)
    assert.equal(searchPipe101.body.records[0].pipeNumber, 101)
    assert.equal(searchPipe101.body.records[0].customer, 'MCWD')

    // 4. Search by pipe serial number '202'
    const searchPipe202 = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=202', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchPipe202.response.status, 200)
    assert.equal(searchPipe202.body.records.length, 1)
    assert.equal(searchPipe202.body.records[0].pipeNumber, 202)
    assert.equal(searchPipe202.body.records[0].customer, 'Regan Industrial')

    // 5. Search with non-matching query
    const searchNonMatch = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=nonexistent-pipe', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchNonMatch.response.status, 200)
    assert.equal(searchNonMatch.body.records.length, 0)
    assert.equal(searchNonMatch.body.pagination.total, 0)
    // Summary KPIs remain intact for the day
    assert.equal(searchNonMatch.body.summary.totalAccepted, 3)
    assert.equal(searchNonMatch.body.summary.specifiedCount, 2)

    // 6. Search query with whitespace is trimmed
    const searchTrimmed = await requestJson(baseUrl, '/api/production?date=2026-03-15&search=%20%20mcwd%20%20', {
      headers: authHeader('Admin'),
    })
    assert.equal(searchTrimmed.response.status, 200)
    assert.equal(searchTrimmed.body.records.length, 1)
    assert.equal(searchTrimmed.body.records[0].customer, 'MCWD')

    // 7. Search query exceeding 100 characters rejected with 400
    const searchTooLong = await requestJson(baseUrl, `/api/production?date=2026-03-15&search=${'x'.repeat(101)}`, {
      headers: authHeader('Admin'),
    })
    assert.equal(searchTooLong.response.status, 400)
    assertError(searchTooLong.body, 'VALIDATION_ERROR')
  })
})

test('CHALLENGER STRESS: API PATCH validation edge cases', async () => {
  const app = loadAppWithMocks({
    'src/modules/production/production.repository.js': createMockRepo(),
  })

  await withTestServer(app, async (baseUrl) => {
    // 1. Single edit: customer > 100 characters rejected
    const resCustLong = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { customer: 'C'.repeat(101) },
    })
    assert.equal(resCustLong.response.status, 400)
    assertError(resCustLong.body, 'VALIDATION_ERROR')

    // 2. Single edit: pipeNumber <= 0 or float rejected
    const resPipeZero = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { pipeNumber: 0 },
    })
    assert.equal(resPipeZero.response.status, 400)
    assertError(resPipeZero.body, 'VALIDATION_ERROR')

    const resPipeFloat = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { pipeNumber: 101.5 },
    })
    assert.equal(resPipeFloat.response.status, 400)
    assertError(resPipeFloat.body, 'VALIDATION_ERROR')

    // 3. Single edit: non-positive dimensions rejected
    const resDimZero = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { thickness: 0 },
    })
    assert.equal(resDimZero.response.status, 400)
    assertError(resDimZero.body, 'VALIDATION_ERROR')

    const resDimNeg = await requestJson(baseUrl, '/api/production/e0000000-0000-4000-8000-000000000001', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: { length: -6000 },
    })
    assert.equal(resDimNeg.response.status, 400)
    assertError(resDimNeg.body, 'VALIDATION_ERROR')

    // 4. Batch edit: pipeNumber in body rejected
    const resBatchPipe = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        pipeNumber: 101,
        customer: 'MCWD',
      },
    })
    assert.equal(resBatchPipe.response.status, 400)
    assertError(resBatchPipe.body, 'VALIDATION_ERROR')

    // 5. Batch edit: whitespace customer normalized to null resulting in no spec fields
    const resBatchBlank = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: ['e0000000-0000-4000-8000-000000000001'],
        customer: '    ',
      },
    })
    assert.equal(resBatchBlank.response.status, 400)
    assertError(resBatchBlank.body, 'VALIDATION_ERROR')

    // 6. Batch edit: > 500 records rejected
    const over500Ids = Array.from({ length: 501 }, (_, i) => {
      const hex = i.toString(16).padStart(12, '0')
      return `00000000-0000-4000-8000-${hex}`
    })
    const resBatch501 = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: over500Ids,
        customer: 'Big Batch',
      },
    })
    assert.equal(resBatch501.response.status, 400)
    assertError(resBatch501.body, 'VALIDATION_ERROR')

    // 7. Batch edit: exactly 500 records succeeds
    const exact500Ids = Array.from({ length: 500 }, (_, i) => {
      const hex = i.toString(16).padStart(12, '0')
      return `00000000-0000-4000-8000-${hex}`
    })
    const resBatch500 = await requestJson(baseUrl, '/api/production/batch', {
      method: 'PATCH',
      headers: authHeader('Admin'),
      body: {
        sensorEventIds: exact500Ids,
        customer: '500 Batch',
      },
    })
    assert.equal(resBatch500.response.status, 200)
    assert.equal(resBatch500.body.matchedCount, 500)
  })
})
