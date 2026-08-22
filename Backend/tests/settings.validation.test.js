const assert = require('node:assert/strict')
const test = require('node:test')

const {
  completeSensorThresholdsSchema,
  patchSettingsSchema,
  settingsParamsSchema,
  shiftScheduleSchema,
} = require('../src/modules/settings/settings.model')

const machineId = '10000000-0000-4000-8000-000000000001'

function threshold(triggerSeconds, recoverySeconds = null, absenceDetectionEnabled = false) {
  return { absenceDetectionEnabled, triggerSeconds, recoverySeconds }
}

function validThresholds() {
  return {
    'S-01': threshold(600),
    'S-02': threshold(300),
    'S-03': threshold(60),
    'S-04': threshold(300),
    'S-05': threshold(null),
  }
}

function validSchedule() {
  return {
    workStart: '08:00',
    workEnd: '17:00',
    breaks: [
      { name: 'Morning Break', startTime: '10:00', endTime: '10:15' },
      { name: 'Lunch Break', startTime: '12:00', endTime: '13:00' },
      { name: 'Afternoon Break', startTime: '15:00', endTime: '15:15' },
    ],
    rampUpGraceMinutes: 10,
  }
}

test('settings params require a UUID machine id', () => {
  assert.equal(settingsParamsSchema.safeParse({ params: { machineId } }).success, true)
  assert.equal(settingsParamsSchema.safeParse({ params: { machineId: 'M-01' } }).success, false)
})

test('settings patch accepts complete sensor entries and strict boundary values', () => {
  const result = patchSettingsSchema.safeParse({
    params: { machineId },
    body: {
      expectedVersion: '1',
      sensorThresholds: {
        'S-01': threshold(1, 1, true),
        'S-04': threshold(3600, 300, true),
      },
    },
  })
  assert.equal(result.success, true)
})

test('settings patch rejects missing sections, noncanonical versions, and unknown fields', () => {
  const invalidBodies = [
    { expectedVersion: '1' },
    { expectedVersion: '01', sensorThresholds: { 'S-01': threshold(60) } },
    { expectedVersion: '0', sensorThresholds: { 'S-01': threshold(60) } },
    { expectedVersion: '1', sensorThresholds: {} },
    { expectedVersion: '1', unexpected: true, sensorThresholds: { 'S-01': threshold(60) } },
    { expectedVersion: '1', sensorThresholds: { 'S-99': threshold(60) } },
    { expectedVersion: '1', sensorThresholds: { 'S-01': { ...threshold(60), extra: true } } },
    { expectedVersion: '1', sensorThresholds: { 'S-01': { triggerSeconds: 60 } } },
  ]

  for (const body of invalidBodies) {
    assert.equal(patchSettingsSchema.safeParse({ params: { machineId }, body }).success, false)
  }
})

test('sensor thresholds enforce enabled values, bounds, complete keys, and S-05 restrictions', () => {
  const enabledWithoutRecovery = validThresholds()
  enabledWithoutRecovery['S-01'] = threshold(60, null, true)

  const enabledOutput = validThresholds()
  enabledOutput['S-05'] = threshold(60, 10, true)

  const missingSensor = validThresholds()
  delete missingSensor['S-04']

  const unknownSensor = { ...validThresholds(), 'S-99': threshold(60) }
  const outOfRangeTrigger = validThresholds()
  outOfRangeTrigger['S-01'] = threshold(3601)
  const outOfRangeRecovery = validThresholds()
  outOfRangeRecovery['S-01'] = threshold(60, 301)

  for (const thresholds of [
    enabledWithoutRecovery,
    enabledOutput,
    missingSensor,
    unknownSensor,
    outOfRangeTrigger,
    outOfRangeRecovery,
  ]) {
    assert.equal(completeSensorThresholdsSchema.safeParse(thresholds).success, false)
  }
})

test('shift schedule accepts same-day boundaries and zero grace', () => {
  const schedule = {
    workStart: '00:00',
    workEnd: '23:59',
    breaks: [
      { name: 'Boundary', startTime: '00:00', endTime: '00:01' },
      { name: 'End', startTime: '23:58', endTime: '23:59' },
    ],
    rampUpGraceMinutes: 0,
  }
  assert.equal(shiftScheduleSchema.safeParse(schedule).success, true)
})

test('shift schedule rejects invalid times, overnight work, and invalid breaks', () => {
  const cases = [
    { ...validSchedule(), workStart: '8:00' },
    { ...validSchedule(), workStart: '17:00', workEnd: '08:00' },
    { ...validSchedule(), breaks: [{ name: 'Bad', startTime: '10:30', endTime: '10:00' }] },
    { ...validSchedule(), breaks: [{ name: 'Outside', startTime: '07:59', endTime: '08:01' }] },
    { ...validSchedule(), rampUpGraceMinutes: 31 },
    { ...validSchedule(), breaks: Array.from({ length: 11 }, (_, index) => ({
      name: `Break ${index}`,
      startTime: '10:00',
      endTime: '10:01',
    })) },
  ]

  for (const schedule of cases) {
    assert.equal(shiftScheduleSchema.safeParse(schedule).success, false)
  }
})

test('shift schedule rejects duplicate names, overlaps, grace overlaps, and grace past work end', () => {
  const duplicateNames = validSchedule()
  duplicateNames.breaks[1].name = ' morning break '

  const overlapping = validSchedule()
  overlapping.breaks[1].startTime = '10:10'

  const graceOverlap = validSchedule()
  graceOverlap.breaks = [
    { name: 'First', startTime: '10:00', endTime: '10:15' },
    { name: 'Second', startTime: '10:20', endTime: '10:30' },
  ]

  const gracePastEnd = validSchedule()
  gracePastEnd.breaks = [{ name: 'Last', startTime: '16:50', endTime: '16:55' }]

  for (const schedule of [duplicateNames, overlapping, graceOverlap, gracePastEnd]) {
    assert.equal(shiftScheduleSchema.safeParse(schedule).success, false)
  }
})
