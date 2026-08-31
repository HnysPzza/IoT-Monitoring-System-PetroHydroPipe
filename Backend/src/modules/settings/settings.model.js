const { z } = require('zod')

const registry = require('../../shared/sensor-registry.json')
const { OUTPUT_SENSOR_CODE } = require('../../shared/sensorIdentity')

const SENSOR_CODES = Object.freeze(registry.sensors.map((sensor) => sensor.code))
const SETTINGS_LIMITS = Object.freeze({
  triggerSeconds: Object.freeze({ minimum: 1, maximum: 3600 }),
  recoverySeconds: Object.freeze({ minimum: 1, maximum: 300 }),
  breaks: Object.freeze({ maximum: 10 }),
  rampUpGraceMinutes: Object.freeze({ minimum: 0, maximum: 30 }),
})
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Time must use 24-hour HH:MM format.')
const MAX_SETTINGS_VERSION = 9223372036854775807n
const positiveVersionSchema = z.string().superRefine((value, context) => {
  if (!/^[1-9]\d*$/.test(value)) {
    context.addIssue({ code: 'custom', message: 'Version must be a positive decimal string.' })
    return
  }
  if (BigInt(value) > MAX_SETTINGS_VERSION) {
    context.addIssue({ code: 'custom', message: 'Version exceeds the supported database range.' })
  }
})

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours * 60) + minutes
}

const sensorThresholdSchema = z.strictObject({
  absenceDetectionEnabled: z.boolean(),
  triggerSeconds: z.number().int().min(SETTINGS_LIMITS.triggerSeconds.minimum).max(SETTINGS_LIMITS.triggerSeconds.maximum).nullable(),
  recoverySeconds: z.number().int().min(SETTINGS_LIMITS.recoverySeconds.minimum).max(SETTINGS_LIMITS.recoverySeconds.maximum).nullable(),
}).superRefine((threshold, context) => {
  if (threshold.absenceDetectionEnabled
    && (threshold.triggerSeconds === null || threshold.recoverySeconds === null)) {
    context.addIssue({
      code: 'custom',
      message: 'Enabled absence detection requires trigger and recovery values.',
    })
  }
})

const sensorShape = Object.fromEntries(
  SENSOR_CODES.map((sensorCode) => [sensorCode, sensorThresholdSchema]),
)

const completeSensorThresholdsSchema = z.strictObject(sensorShape).superRefine((thresholds, context) => {
  const outputThreshold = thresholds[OUTPUT_SENSOR_CODE]
  if (outputThreshold.absenceDetectionEnabled
    || outputThreshold.triggerSeconds !== null
    || outputThreshold.recoverySeconds !== null) {
    context.addIssue({
      code: 'custom',
      path: [OUTPUT_SENSOR_CODE],
      message: `${OUTPUT_SENSOR_CODE} cannot use absence detection.`,
    })
  }
})

const patchSensorThresholdsSchema = z.strictObject(
  Object.fromEntries(SENSOR_CODES.map((sensorCode) => [sensorCode, sensorThresholdSchema.optional()])),
).refine(
  (thresholds) => Object.values(thresholds).some((threshold) => threshold !== undefined),
  { message: 'At least one sensor threshold is required.' },
)

const breakSchema = z.strictObject({
  name: z.string().trim().min(1, 'Break name is required.').max(100, 'Break name is too long.'),
  startTime: timeSchema,
  endTime: timeSchema,
})

const shiftScheduleSchema = z.strictObject({
  workStart: timeSchema,
  workEnd: timeSchema,
  breaks: z.array(breakSchema).max(SETTINGS_LIMITS.breaks.maximum, 'At most 10 breaks are allowed.'),
  rampUpGraceMinutes: z.number().int().min(SETTINGS_LIMITS.rampUpGraceMinutes.minimum).max(SETTINGS_LIMITS.rampUpGraceMinutes.maximum),
}).superRefine((schedule, context) => {
  const workStart = toMinutes(schedule.workStart)
  const workEnd = toMinutes(schedule.workEnd)

  if (workStart >= workEnd) {
    context.addIssue({
      code: 'custom',
      path: ['workEnd'],
      message: 'Work end must be later than work start on the same day.',
    })
    return
  }

  const seenNames = new Set()
  const orderedBreaks = schedule.breaks
    .map((shiftBreak, index) => ({
      ...shiftBreak,
      index,
      start: toMinutes(shiftBreak.startTime),
      end: toMinutes(shiftBreak.endTime),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end)

  for (const shiftBreak of orderedBreaks) {
    const normalizedName = shiftBreak.name.toLocaleLowerCase('en-US')
    if (seenNames.has(normalizedName)) {
      context.addIssue({
        code: 'custom',
        path: ['breaks', shiftBreak.index, 'name'],
        message: 'Break names must be unique.',
      })
    }
    seenNames.add(normalizedName)

    if (shiftBreak.start >= shiftBreak.end) {
      context.addIssue({
        code: 'custom',
        path: ['breaks', shiftBreak.index, 'endTime'],
        message: 'Break end must be later than break start.',
      })
    }

    if (shiftBreak.start < workStart || shiftBreak.end > workEnd) {
      context.addIssue({
        code: 'custom',
        path: ['breaks', shiftBreak.index],
        message: 'Break must be inside the work window.',
      })
    }
  }

  for (let index = 0; index < orderedBreaks.length; index += 1) {
    const shiftBreak = orderedBreaks[index]
    const graceEnd = shiftBreak.end + schedule.rampUpGraceMinutes
    const nextBreak = orderedBreaks[index + 1]

    if (graceEnd > workEnd) {
      context.addIssue({
        code: 'custom',
        path: ['breaks', shiftBreak.index],
        message: 'Break grace window must not exceed work end.',
      })
    }

    if (nextBreak && graceEnd > nextBreak.start) {
      context.addIssue({
        code: 'custom',
        path: ['breaks', nextBreak.index],
        message: 'Breaks and grace windows must not overlap.',
      })
    }
  }
})

const settingsParamsSchema = z.object({
  params: z.strictObject({
    machineId: z.string().uuid('Invalid machine id.'),
  }),
  query: z.strictObject({}).optional().default({}),
})

const patchSettingsSchema = z.object({
  params: z.strictObject({
    machineId: z.string().uuid('Invalid machine id.'),
  }),
  query: z.strictObject({}).optional().default({}),
  body: z.strictObject({
    expectedVersion: positiveVersionSchema,
    sensorThresholds: patchSensorThresholdsSchema.optional(),
    shiftSchedule: shiftScheduleSchema.optional(),
  }).refine(
    (body) => body.sensorThresholds !== undefined || body.shiftSchedule !== undefined,
    { message: 'At least one settings section is required.' },
  ),
})

const completeSettingsSchema = z.strictObject({
  sensorThresholds: completeSensorThresholdsSchema,
  shiftSchedule: shiftScheduleSchema,
})

const storedSettingsRecordSchema = z.strictObject({
  machine_id: z.string().uuid(),
  sensor_thresholds: completeSensorThresholdsSchema,
  shift_schedule: shiftScheduleSchema,
  version: z.union([
    positiveVersionSchema,
    z.number().int().positive().refine(Number.isSafeInteger, 'Stored version exceeds safe integer range.'),
  ]),
  updated_at: z.string().datetime({ offset: true }),
  updated_by: z.string().uuid().nullable(),
})

module.exports = {
  SENSOR_CODES,
  SETTINGS_LIMITS,
  completeSensorThresholdsSchema,
  completeSettingsSchema,
  patchSettingsSchema,
  sensorThresholdSchema,
  settingsParamsSchema,
  shiftScheduleSchema,
  storedSettingsRecordSchema,
}
