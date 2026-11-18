import { describe, expect, it } from 'vitest'
import {
  getBackToWorkDate,
  getInvalidBreakIndices,
  getNextBreakSlot,
  groupCalendarEntries,
  normalizeRestDays,
  settingsAreEqual,
  sortBreaks,
  validateOperationalSettings,
} from './settingsUtils.js'

const constraints = {
  sensorCodes: ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'],
  outputSensorCode: 'S-05',
  triggerSeconds: { maximum: 3600, minimumWhenEnabled: 10 },
  recoverySeconds: { maximum: 300, minimumWhenEnabled: 20 },
  breaks: { maximum: 10 },
  rampUpGraceMinutes: { minimum: 0, maximum: 30 },
}

function validSettings() {
  return {
    sensorThresholds: Object.fromEntries(constraints.sensorCodes.map((code) => [code, {
      absenceDetectionEnabled: code === 'S-01',
      triggerSeconds: code === 'S-05' ? null : 60,
      recoverySeconds: code === 'S-01' ? 60 : null,
    }])),
    shiftSchedule: {
      workStart: '08:00',
      workEnd: '17:00',
      rampUpGraceMinutes: 10,
      breaks: [{ name: 'Lunch', startTime: '12:00', endTime: '13:00' }],
    },
  }
}

describe('settings validation', () => {
  it('accepts the complete valid document and orders breaks without mutation', () => {
    const settings = validSettings()
    expect(validateOperationalSettings(settings, constraints)).toEqual({})
    const input = [
      { name: 'Lunch', startTime: '12:00', endTime: '13:00' },
      { name: 'Morning', startTime: '10:00', endTime: '10:15' },
    ]
    expect(sortBreaks(input).map((entry) => entry.name)).toEqual(['Morning', 'Lunch'])
    expect(input[0].name).toBe('Lunch')
  })

  it('rejects S-05 activation, non-whole-minute or out-of-range thresholds, and grace overlap', () => {
    const settings = validSettings()
    settings.sensorThresholds['S-01'] = {
      absenceDetectionEnabled: true,
      triggerSeconds: 90,
      recoverySeconds: 60,
    }
    settings.sensorThresholds['S-02'] = {
      absenceDetectionEnabled: true,
      triggerSeconds: 60,
      recoverySeconds: 360,
    }
    settings.sensorThresholds['S-05'] = {
      absenceDetectionEnabled: true,
      triggerSeconds: 60,
      recoverySeconds: 60,
    }
    settings.shiftSchedule.breaks.push({ name: 'Next', startTime: '13:05', endTime: '13:20' })
    const errors = validateOperationalSettings(settings, constraints)
    expect(errors['S-01']).toBe('Trigger must be 1-60 minutes.')
    expect(errors['S-02']).toBe('Recovery must be 1-5 minutes.')
    expect(errors['S-05']).toMatch(/cannot use absence/i)
    expect(errors.breaks).toMatch(/no overlap/i)
  })

  it('validates S-03 rotation stall bounds even when absence detection is disabled', () => {
    const withStallConstraints = {
      ...constraints,
      spindleSensorCode: 'S-03',
      rotationStallMs: { minimum: 500, maximum: 30000, default: 3000 },
    }
    const valid = validSettings()
    valid.sensorThresholds['S-03'].rotationStallMs = 4500
    expect(validateOperationalSettings(valid, withStallConstraints)).toEqual({})

    for (const invalidStall of [null, 400, 30100]) {
      const candidate = validSettings()
      candidate.sensorThresholds['S-03'].rotationStallMs = invalidStall
      expect(validateOperationalSettings(candidate, withStallConstraints)['S-03']).toBe(
        'Rotation stall must be 0.5-30 seconds.',
      )
    }

    const badStep = validSettings()
    badStep.sensorThresholds['S-03'].rotationStallMs = 3250
    expect(validateOperationalSettings(badStep, withStallConstraints)['S-03']).toBe(
      'Rotation stall must use 0.1-second steps.',
    )

    const stallAtOrAboveTrigger = validSettings()
    stallAtOrAboveTrigger.sensorThresholds['S-03'] = {
      absenceDetectionEnabled: true,
      triggerSeconds: 60,
      recoverySeconds: 60,
      rotationStallMs: 60000,
    }
    const stallVsTriggerErrors = validateOperationalSettings(stallAtOrAboveTrigger, {
      ...withStallConstraints,
      rotationStallMs: { minimum: 500, maximum: 90000, default: 3000 },
    })
    expect(stallVsTriggerErrors['S-03']).toBe('Rotation stall must be shorter than the trigger limit.')
    expect(stallVsTriggerErrors['S-03.rotationStallMs']).toBe('Rotation stall must be shorter than the trigger limit.')

    const bothInvalid = validSettings()
    bothInvalid.sensorThresholds['S-03'] = {
      absenceDetectionEnabled: true,
      triggerSeconds: 0,
      recoverySeconds: 60,
      rotationStallMs: 200,
    }
    const bothErrors = validateOperationalSettings(bothInvalid, withStallConstraints)
    expect(bothErrors['S-03.rotationStallMs']).toBe('Rotation stall must be 0.5-30 seconds.')
    expect(bothErrors['S-03']).toBe('Trigger must be 1-60 minutes.')
  })

  it('reports trigger and recovery validation errors independently when both are invalid on the same sensor', () => {
    const settings = validSettings()
    settings.sensorThresholds['S-01'] = {
      absenceDetectionEnabled: true,
      triggerSeconds: 0,
      recoverySeconds: 360,
    }
    const errors = validateOperationalSettings(settings, constraints)
    expect(errors['S-01.triggerSeconds']).toBe('Trigger must be 1-60 minutes.')
    expect(errors['S-01.recoverySeconds']).toBe('Recovery must be 1-5 minutes.')
    expect(errors['S-01']).toBe('Trigger must be 1-60 minutes.')
  })

  it('computes the next non-overlapping 15-minute break slot accounting for ramp-up grace', () => {
    const slot = getNextBreakSlot({
      workStart: '08:00',
      workEnd: '17:00',
      rampUpGraceMinutes: 10,
      breaks: [
        { name: 'Morning', startTime: '10:00', endTime: '10:15' },
        { name: 'Lunch', startTime: '12:00', endTime: '13:00' },
      ],
    })
    expect(slot).toEqual({ startTime: '10:25', endTime: '10:40' })
    const candidate = validSettings()
    candidate.shiftSchedule.breaks = [
      { name: 'Morning', startTime: '10:00', endTime: '10:15' },
      { name: 'Lunch', startTime: '12:00', endTime: '13:00' },
      { name: 'Break 3', ...slot },
    ]
    expect(validateOperationalSettings(candidate, constraints)).toEqual({})
  })

  it('validates weekly restDays bounds and normalizes comparison across legacy schedules', () => {
    expect(normalizeRestDays(['Sunday', 'friday', 'sunday', 'invalid'])).toEqual(['sunday', 'friday'])

    const legacy = validSettings()
    const normalized = validSettings()
    normalized.shiftSchedule.restDays = []
    expect(settingsAreEqual(legacy, normalized)).toBe(true)

    const allSeven = validSettings()
    allSeven.shiftSchedule.restDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    expect(validateOperationalSettings(allSeven, constraints).restDays).toMatch(/at least one working day/i)

    const dupes = validSettings()
    dupes.shiftSchedule.restDays = ['sunday', 'sunday']
    expect(validateOperationalSettings(dupes, constraints).restDays).toMatch(/unique weekdays/i)
  })

  it('computes Back to work skipping weekly rest days and non-working overrides while respecting working overrides', () => {
    expect(
      getBackToWorkDate('2027-01-02', ['sunday'], [
        { calendarDate: '2027-01-03', isWorking: false },
      ]),
    ).toBe('2027-01-04')

    expect(
      getBackToWorkDate('2027-01-02', ['sunday'], [
        { calendarDate: '2027-01-03', isWorking: true },
      ]),
    ).toBe('2027-01-03')
  })

  it('identifies only the invalid break indices without flagging valid breaks', () => {
    const schedule = {
      workStart: '08:00',
      workEnd: '17:00',
      rampUpGraceMinutes: 10,
      breaks: [
        { name: 'Morning', startTime: '10:00', endTime: '10:15' },
        { name: 'Lunch', startTime: '12:00', endTime: '13:00' },
        { name: 'TooEarly', startTime: '13:05', endTime: '13:20' },
      ],
    }
    const invalid = getInvalidBreakIndices(schedule, constraints)
    expect(invalid.has(0)).toBe(false)
    expect(invalid.has(1)).toBe(false)
    expect(invalid.has(2)).toBe(true)
  })

  it('collapses calendar entries sharing a groupId into a single range summary sorted chronologically', () => {
    const grouped = groupCalendarEntries(
      [
        {
          calendarDate: '2020-12-23',
          name: 'Year-End Shutdown',
          dayType: 'day_off',
          isWorking: false,
          reason: 'Annual closure',
          source: 'manual',
          groupId: 'group-1',
          version: '1',
        },
        {
          calendarDate: '2027-01-02',
          name: 'Special Closure',
          dayType: 'day_off',
          isWorking: false,
          reason: null,
          source: 'manual',
          groupId: null,
          version: '1',
        },
        {
          calendarDate: '2020-12-24',
          name: 'Year-End Shutdown',
          dayType: 'day_off',
          isWorking: false,
          reason: 'Annual closure',
          source: 'manual',
          groupId: 'group-1',
          version: '1',
        },
        {
          calendarDate: '2027-01-03',
          name: 'Year-End Shutdown',
          dayType: 'day_off',
          isWorking: false,
          reason: 'Annual closure',
          source: 'manual',
          groupId: 'group-1',
          version: '1',
        },
      ],
      '2026-11-16',
    )

    expect(grouped).toHaveLength(2)
    expect(grouped[0]).toMatchObject({
      key: 'group:group-1',
      isRangeGroup: true,
      groupId: 'group-1',
      name: 'Year-End Shutdown',
      startDate: '2020-12-23',
      endDate: '2027-01-03',
      dayCount: 3,
      hasFutureDates: true,
      isAllLocked: false,
    })
    expect(grouped[1]).toMatchObject({
      key: 'day:2027-01-02',
      isRangeGroup: false,
      startDate: '2027-01-02',
      endDate: '2027-01-02',
      dayCount: 1,
      hasFutureDates: true,
      isAllLocked: false,
    })
  })
})
