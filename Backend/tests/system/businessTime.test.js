const assert = require('node:assert/strict')
const test = require('node:test')

const {
  addBusinessMonths,
  formatBusinessDate,
  formatBusinessTime,
  getBusinessDayRange,
  startOfBusinessWeek,
  startOfBusinessMonth,
} = require('../../src/shared/businessTime')

test('Manila business day is stable regardless of the server timezone', () => {
  const range = getBusinessDayRange('2026-07-13')

  assert.equal(range.start.toISOString(), '2026-07-12T16:00:00.000Z')
  assert.equal(range.end.toISOString(), '2026-07-13T16:00:00.000Z')
  assert.equal(formatBusinessDate('2026-07-12T16:00:00.000Z'), '2026-07-13')
  assert.equal(formatBusinessTime('2026-07-12T16:00:00.000Z', { hour: '2-digit', minute: '2-digit' }), '12:00 AM')
})

test('Manila business weeks start on Monday midnight', () => {
  assert.equal(startOfBusinessWeek('2026-07-15T08:00:00.000Z').toISOString(), '2026-07-12T16:00:00.000Z')
})

test('Manila month boundaries remain stable across year changes', () => {
  const december = startOfBusinessMonth('2026-12-15T08:00:00.000Z')
  assert.equal(december.toISOString(), '2026-11-30T16:00:00.000Z')
  assert.equal(addBusinessMonths(december, 1).toISOString(), '2026-12-31T16:00:00.000Z')
})

test('businessTime pads years below 1000 instead of producing Invalid Date', () => {
  assert.match(formatBusinessDate('0001-01-02T00:00:00.000Z'), /^0001-01-0[12]$/)
  assert.equal(Number.isNaN(startOfBusinessMonth('0001-01-02T00:00:00.000Z').getTime()), false)
  assert.equal(Number.isNaN(addBusinessMonths('0001-01-02T00:00:00.000Z', 1).getTime()), false)
})

test('query schemas clamp business dates and cap page at 10000', () => {
  const { listAuditLogsSchema } = require('../../src/modules/audit/audit.model')
  const { listDowntimeSchema } = require('../../src/modules/downtime/downtime.model')
  const { reportSummarySchema } = require('../../src/modules/reports/reports.model')

  assert.equal(listAuditLogsSchema.safeParse({ query: { page: '10001' } }).success, false)
  assert.equal(listAuditLogsSchema.safeParse({ query: { dateFrom: '0001-01-01' } }).success, false)
  assert.equal(listAuditLogsSchema.safeParse({ query: { page: '10000', dateFrom: '2026-01-01' } }).success, true)

  assert.equal(listDowntimeSchema.safeParse({ query: { page: '10001' } }).success, false)
  assert.equal(listDowntimeSchema.safeParse({ query: { date: '0001-01-01' } }).success, false)
  assert.equal(listDowntimeSchema.safeParse({ query: { page: '10000', date: '2026-11-25' } }).success, true)

  assert.equal(reportSummarySchema.safeParse({ query: { date: '0001-01-01' } }).success, false)
  assert.equal(reportSummarySchema.safeParse({ query: { date: '2026-11-25' } }).success, true)
})
