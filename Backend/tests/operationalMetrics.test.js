const assert = require('node:assert/strict')
const test = require('node:test')

const {
  attributeMachineDowntime,
  calculateMachineMetrics,
  calculateRecordMetrics,
} = require('../src/shared/operationalMetrics')

const window = {
  start: new Date('2026-08-24T00:00:00.000Z'),
  end: new Date('2026-08-24T10:00:00.000Z'),
}
const settingsHistory = [{
  version: '1',
  effective_from: null,
  effective_to: null,
  shift_schedule: {
    workStart: '08:00',
    workEnd: '18:00',
    breaks: [{ name: 'Lunch', startTime: '12:00', endTime: '13:00' }],
    rampUpGraceMinutes: 10,
  },
}]

test('record metrics preserve raw time while excluding breaks and grace from loss', () => {
  const result = calculateRecordMetrics({
    record: {
      started_at: '2026-08-24T03:30:00.000Z',
      ended_at: '2026-08-24T05:30:00.000Z',
    },
    window,
    settingsHistory,
    asOf: window.end,
  })

  assert.deepEqual(result, {
    durationSeconds: 7200,
    unplannedSeconds: 3000,
    plannedExcludedSeconds: 4200,
    durationMinutes: 120,
    unplannedMinutes: 50,
    plannedExcludedMinutes: 70,
    estimatedLoss: 115,
  })
})

test('machine metrics union overlapping sensors and use eligible schedule as denominator', () => {
  const result = calculateMachineMetrics({
    records: [
      { id: 'one', started_at: '2026-08-24T00:00:00.000Z', ended_at: '2026-08-24T02:00:00.000Z' },
      { id: 'two', started_at: '2026-08-24T01:00:00.000Z', ended_at: '2026-08-24T03:00:00.000Z' },
    ],
    window,
    settingsHistory,
    asOf: window.end,
  })

  assert.equal(result.durationMinutes, 180)
  assert.equal(result.unplannedMinutes, 180)
  assert.equal(result.scheduledEligibleSeconds, 8 * 60 * 60 + 50 * 60)
  assert.equal(result.availabilityPercent, 66)
  assert.equal(result.estimatedLoss, 414)
})

test('zero eligible schedule returns null availability instead of a false 100 percent', () => {
  const offShiftWindow = {
    start: new Date('2026-08-23T16:00:00.000Z'),
    end: new Date('2026-08-23T20:00:00.000Z'),
  }
  const result = calculateMachineMetrics({
    records: [],
    window: offShiftWindow,
    settingsHistory,
    asOf: offShiftWindow.end,
  })

  assert.equal(result.scheduledEligibleSeconds, 0)
  assert.equal(result.availabilityPercent, null)
})

test('overlap attribution creates a concurrent row without double-counting the machine total', () => {
  const rows = attributeMachineDowntime({
    records: [
      {
        id: 'one',
        cause: 'Flux Refill',
        sensors: { sensor_code: 'S-01' },
        started_at: '2026-08-24T00:00:00.000Z',
        ended_at: '2026-08-24T02:00:00.000Z',
      },
      {
        id: 'two',
        cause: 'ID Filler Refill',
        sensors: { sensor_code: 'S-02' },
        started_at: '2026-08-24T01:00:00.000Z',
        ended_at: '2026-08-24T03:00:00.000Z',
      },
    ],
    window,
    settingsHistory,
    asOf: window.end,
  })

  assert.deepEqual(rows.map(({ cause, sensor, durationMinutes }) => ({ cause, sensor, durationMinutes })), [
    { cause: 'Flux Refill', sensor: 'S-01', durationMinutes: 60 },
    { cause: 'Concurrent causes', sensor: 'Multiple', durationMinutes: 60 },
    { cause: 'ID Filler Refill', sensor: 'S-02', durationMinutes: 60 },
  ])
  assert.equal(rows.reduce((sum, row) => sum + row.durationMinutes, 0), 180)
})
