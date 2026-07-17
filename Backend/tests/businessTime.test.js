const assert = require('node:assert/strict')
const test = require('node:test')

const {
  addBusinessMonths,
  formatBusinessDate,
  formatBusinessTime,
  getBusinessDayRange,
  startOfBusinessWeek,
  startOfBusinessMonth,
} = require('../src/shared/businessTime')

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
