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
      triggerSeconds: code === 'S-05' ? null : 30,
      recoverySeconds: code === 'S-01' ? 20 : null,
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

  it('rejects S-05 activation, unmeasurable thresholds, and grace overlap', () => {
    const settings = validSettings()
    settings.sensorThresholds['S-05'] = {
      absenceDetectionEnabled: true,
      triggerSeconds: 1,
      recoverySeconds: 1,
    }
    settings.shiftSchedule.breaks.push({ name: 'Next', startTime: '13:05', endTime: '13:20' })
    const errors = validateOperationalSettings(settings, constraints)
    expect(errors['S-05']).toMatch(/cannot use absence/i)
    expect(errors.breaks).toMatch(/no overlap/i)
  })
})
