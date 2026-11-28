const assert = require('node:assert/strict')
const test = require('node:test')

const { listDowntimeSchema, updateDowntimeSchema } = require('../../../src/modules/downtime/downtime.model')

const downtimeId = '55555555-5555-4555-8555-555555555555'
const approvedCauses = [
  'Corrective Maintenance',
  'Manual Cutting',
  'Misalignment',
  'Consumable Shortage',
  'Hydraulic Failure',
  'Electrical Failure',
  'Crane Failure',
  'Other',
]

test('downtime updates accept every approved manual cause', () => {
  for (const cause of approvedCauses) {
    const result = updateDowntimeSchema.safeParse({
      params: { id: downtimeId },
      body: { cause },
    })
    assert.equal(result.success, true, cause)
  }
})

test('downtime updates reject system and legacy causes as new manual assignments', () => {
  for (const cause of ['Pending Cause Review', 'Coil Joint', 'Weld Wire Refill', 'Flux Refill']) {
    const result = updateDowntimeSchema.safeParse({
      params: { id: downtimeId },
      body: { cause },
    })
    assert.equal(result.success, false, cause)
  }
})

test('downtime list schema accepts valid dateFrom and dateTo range and rejects inverted range', () => {
  const valid = listDowntimeSchema.safeParse({
    query: { dateFrom: '2026-07-06', dateTo: '2026-07-12' },
  })
  assert.equal(valid.success, true)

  const inverted = listDowntimeSchema.safeParse({
    query: { dateFrom: '2026-07-13', dateTo: '2026-07-06' },
  })
  assert.equal(inverted.success, false)
})

test('downtime list schema accepts up to 366 days and rejects oversized multi-year ranges immediately', () => {
  const leapYearMax = listDowntimeSchema.safeParse({
    query: { dateFrom: '2024-01-01', dateTo: '2025-01-01' },
  })
  assert.equal(leapYearMax.success, true)

  const overCap = listDowntimeSchema.safeParse({
    query: { dateFrom: '2024-01-01', dateTo: '2025-01-02' },
  })
  assert.equal(overCap.success, false)

  const t0 = performance.now()
  const century = listDowntimeSchema.safeParse({
    query: { dateFrom: '1926-01-01', dateTo: '2026-12-31' },
  })
  const elapsedMs = performance.now() - t0
  assert.equal(century.success, false)
  assert.ok(elapsedMs < 50, `Expected immediate schema rejection, took ${elapsedMs}ms`)

  assert.equal(listDowntimeSchema.safeParse({ query: { cause: 'x'.repeat(101) } }).success, false)
  assert.equal(listDowntimeSchema.safeParse({ query: { extra: '1' } }).success, false)
  assert.equal(listDowntimeSchema.safeParse({ query: { cause: 'Corrective Maintenance' } }).success, true)
})
