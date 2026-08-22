const assert = require('node:assert/strict')
const test = require('node:test')

const {
  advanceByEligibleSeconds,
  buildEligibleIntervals,
  calculateDowntimeBreakdown,
  getEligibleSeconds,
  getUnionedDowntimeSeconds,
  isEligibleAt,
  subtractIntervals,
  unionIntervals,
} = require('../src/shared/operationalTime')

const defaultSchedule = {
  workStart: '08:00',
  workEnd: '17:00',
  breaks: [
    { name: 'Morning Break', startTime: '10:00', endTime: '10:15' },
    { name: 'Lunch Break', startTime: '12:00', endTime: '13:00' },
    { name: 'Afternoon Break', startTime: '15:00', endTime: '15:15' },
  ],
  rampUpGraceMinutes: 10,
}

function baseline(schedule = defaultSchedule) {
  return [{ version: '1', effectiveFrom: null, effectiveTo: null, shiftSchedule: schedule }]
}

function manila(value) {
  return `2026-08-24T${value}:00+08:00`
}

test('default schedule yields exactly 420 eligible minutes', () => {
  const seconds = getEligibleSeconds({
    start: manila('00:00'),
    end: '2026-08-25T00:00:00+08:00',
    settingsHistory: baseline(),
  })
  assert.equal(seconds, 420 * 60)
})

test('half-open schedule, break, grace, and work-end boundaries are exact', () => {
  const history = baseline()
  assert.equal(isEligibleAt({ at: manila('07:59'), settingsHistory: history }), false)
  assert.equal(isEligibleAt({ at: manila('08:00'), settingsHistory: history }), true)
  assert.equal(isEligibleAt({ at: manila('09:59'), settingsHistory: history }), true)
  assert.equal(isEligibleAt({ at: manila('10:00'), settingsHistory: history }), false)
  assert.equal(isEligibleAt({ at: manila('10:15'), settingsHistory: history }), false)
  assert.equal(isEligibleAt({ at: manila('10:25'), settingsHistory: history }), true)
  assert.equal(isEligibleAt({ at: manila('17:00'), settingsHistory: history }), false)
})

test('empty breaks and zero grace preserve the complete work window', () => {
  const settingsHistory = baseline({
    workStart: '08:00',
    workEnd: '17:00',
    breaks: [],
    rampUpGraceMinutes: 0,
  })
  assert.equal(getEligibleSeconds({
    start: manila('00:00'),
    end: '2026-08-25T00:00:00+08:00',
    settingsHistory,
  }), 9 * 60 * 60)
})

test('downtime is clipped to request range and split into raw and planned time', () => {
  const result = calculateDowntimeBreakdown({
    record: { started_at: manila('09:30'), ended_at: manila('10:30') },
    windowStart: manila('09:45'),
    windowEnd: manila('10:20'),
    settingsHistory: baseline(),
  })
  assert.deepEqual(result, {
    durationSeconds: 35 * 60,
    unplannedSeconds: 15 * 60,
    plannedExcludedSeconds: 20 * 60,
  })
})

test('open downtime uses one supplied asOf value', () => {
  const result = calculateDowntimeBreakdown({
    record: { startedAt: manila('16:30'), endedAt: null },
    windowStart: manila('00:00'),
    windowEnd: '2026-08-25T00:00:00+08:00',
    asOf: manila('17:30'),
    settingsHistory: baseline(),
  })
  assert.deepEqual(result, {
    durationSeconds: 60 * 60,
    unplannedSeconds: 30 * 60,
    plannedExcludedSeconds: 30 * 60,
  })
})

test('multi-day downtime excludes every break, grace, and off-shift interval', () => {
  const result = calculateDowntimeBreakdown({
    record: {
      started_at: '2026-08-24T16:30:00+08:00',
      ended_at: '2026-08-25T08:30:00+08:00',
    },
    windowStart: '2026-08-24T00:00:00+08:00',
    windowEnd: '2026-08-26T00:00:00+08:00',
    settingsHistory: baseline(),
  })
  assert.equal(result.durationSeconds, 16 * 60 * 60)
  assert.equal(result.unplannedSeconds, 60 * 60)
})

test('effective-dated schedule changes split the same day without gaps', () => {
  const settingsHistory = [
    {
      version: '1',
      effectiveFrom: null,
      effectiveTo: manila('12:00'),
      shiftSchedule: { workStart: '08:00', workEnd: '17:00', breaks: [], rampUpGraceMinutes: 0 },
    },
    {
      version: '2',
      effectiveFrom: manila('12:00'),
      effectiveTo: null,
      shiftSchedule: { workStart: '10:00', workEnd: '15:00', breaks: [], rampUpGraceMinutes: 0 },
    },
  ]
  assert.equal(getEligibleSeconds({
    start: manila('00:00'),
    end: '2026-08-25T00:00:00+08:00',
    settingsHistory,
  }), 7 * 60 * 60)
})

test('missing and overlapping settings history fail closed', () => {
  const common = {
    start: manila('08:00'),
    end: manila('17:00'),
  }
  assert.throws(
    () => buildEligibleIntervals({ ...common, settingsHistory: [] }),
    { code: 'SETTINGS_HISTORY_GAP' },
  )
  assert.throws(
    () => buildEligibleIntervals({
      ...common,
      settingsHistory: [
        { effectiveFrom: null, effectiveTo: manila('10:00'), shiftSchedule: defaultSchedule },
        { effectiveFrom: manila('11:00'), effectiveTo: null, shiftSchedule: defaultSchedule },
      ],
    }),
    { code: 'SETTINGS_HISTORY_GAP' },
  )
  assert.throws(
    () => buildEligibleIntervals({
      ...common,
      settingsHistory: [
        { effectiveFrom: null, effectiveTo: manila('12:00'), shiftSchedule: defaultSchedule },
        { effectiveFrom: manila('11:00'), effectiveTo: null, shiftSchedule: defaultSchedule },
      ],
    }),
    { code: 'SETTINGS_HISTORY_OVERLAP' },
  )
})

test('union merges adjacent, nested, identical, and overlapping intervals', () => {
  const intervals = unionIntervals([
    { start: manila('08:00'), end: manila('09:00') },
    { start: manila('08:15'), end: manila('08:30') },
    { start: manila('09:00'), end: manila('10:00') },
    { start: manila('08:00'), end: manila('09:00') },
  ])
  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].start.toISOString(), new Date(manila('08:00')).toISOString())
  assert.equal(intervals[0].end.toISOString(), new Date(manila('10:00')).toISOString())
})

test('subtraction handles adjacent, nested, and clipped exclusions', () => {
  const result = subtractIntervals(
    { start: manila('08:00'), end: manila('12:00') },
    [
      { start: manila('07:00'), end: manila('08:30') },
      { start: manila('09:00'), end: manila('10:00') },
      { start: manila('09:15'), end: manila('09:30') },
      { start: manila('10:00'), end: manila('10:30') },
    ],
  )
  assert.deepEqual(result.map((interval) => [interval.start.toISOString(), interval.end.toISOString()]), [
    [new Date(manila('08:30')).toISOString(), new Date(manila('09:00')).toISOString()],
    [new Date(manila('10:30')).toISOString(), new Date(manila('12:00')).toISOString()],
  ])
})

test('machine totals union simultaneous sensor downtime once', () => {
  const result = getUnionedDowntimeSeconds({
    records: [
      { started_at: manila('08:00'), ended_at: manila('09:00') },
      { started_at: manila('08:30'), ended_at: manila('09:30') },
      { started_at: manila('10:00'), ended_at: manila('10:30') },
    ],
    windowStart: manila('08:00'),
    windowEnd: manila('11:00'),
    settingsHistory: baseline(),
  })
  assert.equal(result.durationSeconds, 2 * 60 * 60)
  assert.equal(result.unplannedSeconds, 95 * 60)
  assert.equal(result.plannedExcludedSeconds, 25 * 60)
})

test('calculations retain integer seconds without per-record minute rounding', () => {
  const result = getUnionedDowntimeSeconds({
    records: [
      { started_at: manila('08:00'), ended_at: '2026-08-24T08:00:31+08:00' },
      { started_at: '2026-08-24T08:00:40+08:00', ended_at: '2026-08-24T08:01:10+08:00' },
    ],
    windowStart: manila('08:00'),
    windowEnd: manila('09:00'),
    settingsHistory: baseline(),
  })
  assert.equal(result.durationSeconds, 61)
  assert.equal(result.unplannedSeconds, 61)
})

test('advancing eligible seconds crosses a break and returns the exact threshold instant', () => {
  const reachedAt = advanceByEligibleSeconds({
    start: manila('09:55'),
    end: manila('11:00'),
    seconds: 10 * 60,
    settingsHistory: baseline(),
  })
  assert.equal(reachedAt.toISOString(), new Date(manila('10:30')).toISOString())
})

test('advancing beyond available eligible time returns null and zero keeps the start', () => {
  const args = {
    start: manila('16:55'),
    end: manila('17:30'),
    settingsHistory: baseline(),
  }
  assert.equal(advanceByEligibleSeconds({ ...args, seconds: 10 * 60 }), null)
  assert.equal(advanceByEligibleSeconds({ ...args, seconds: 0 }).toISOString(), new Date(manila('16:55')).toISOString())
})

test('invalid intervals and schedules are rejected before calculation', () => {
  assert.throws(
    () => getEligibleSeconds({ start: manila('09:00'), end: manila('08:00'), settingsHistory: baseline() }),
    { code: 'INVALID_INTERVAL' },
  )
  assert.throws(
    () => getEligibleSeconds({
      start: manila('08:00'),
      end: manila('17:00'),
      settingsHistory: baseline({ ...defaultSchedule, workStart: '25:00' }),
    }),
    { code: 'INVALID_SCHEDULE' },
  )
})
