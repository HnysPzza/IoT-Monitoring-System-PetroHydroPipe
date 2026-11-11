import { describe, expect, it } from 'vitest'
import { sortBreaks, validateOperationalSettings } from './settingsUtils.js'

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
    expect(validateOperationalSettings(stallAtOrAboveTrigger, {
      ...withStallConstraints,
      rotationStallMs: { minimum: 500, maximum: 90000, default: 3000 },
    })['S-03']).toBe('Rotation stall must be shorter than the trigger limit.')
  })
})
