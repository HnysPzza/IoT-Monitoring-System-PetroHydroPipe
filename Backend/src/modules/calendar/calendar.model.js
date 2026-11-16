const { z } = require('zod')

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CALENDAR_VERSION = 9223372036854775807n

const CALENDAR_DAY_TYPES = Object.freeze([
  'holiday',
  'day_off',
  'machine_not_scheduled',
])

const CALENDAR_RANGE_DAY_TYPES = Object.freeze([
  'day_off',
  'machine_not_scheduled',
])

const CALENDAR_SOURCES = Object.freeze([
  'seeded',
  'manual',
])

const CALENDAR_LIMITS = Object.freeze({
  maxRangeDays: 62,
  maxNameLength: 150,
  maxReasonLength: 500,
})

function isValidBusinessDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
  )
}

function getInclusiveDateSpanDays(startDate, endDate) {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
  const startUtc = Date.UTC(startYear, startMonth - 1, startDay)
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay)
  return Math.round((endUtc - startUtc) / DAY_MS) + 1
}

const businessDateSchema = z
  .string()
  .refine(isValidBusinessDate, 'Date must be a valid YYYY-MM-DD calendar date.')

const positiveVersionSchema = z
  .union([
    z.string(),
    z.number().int().positive().refine(Number.isSafeInteger, 'Version exceeds safe integer range.'),
  ])
  .transform((value) => String(value))
  .superRefine((value, context) => {
    if (!/^[1-9]\d*$/.test(value)) {
      context.addIssue({ code: 'custom', message: 'Version must be a positive integer.' })
      return
    }
    if (BigInt(value) > MAX_CALENDAR_VERSION) {
      context.addIssue({ code: 'custom', message: 'Version exceeds the supported database range.' })
    }
  })

const getCalendarQuerySchema = z.object({
  params: z.strictObject({
    machineId: z.string().uuid('Invalid machine id.'),
  }),
  query: z
    .strictObject({
      from: businessDateSchema.optional(),
      to: businessDateSchema.optional(),
    })
    .optional()
    .default({})
    .superRefine((query, context) => {
      if (query.from && query.to && query.from > query.to) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'End date must be on or after start date.',
        })
      }
    }),
})

const putCalendarDaySchema = z.object({
  params: z.strictObject({
    machineId: z.string().uuid('Invalid machine id.'),
    calendarDate: businessDateSchema,
  }),
  query: z.strictObject({}).optional().default({}),
  body: z
    .strictObject({
      dayType: z.enum(CALENDAR_DAY_TYPES),
      name: z
        .string()
        .trim()
        .min(1, 'Calendar entry name is required.')
        .max(CALENDAR_LIMITS.maxNameLength, 'Calendar entry name is too long.')
        .optional(),
      isWorking: z.boolean().optional(),
      reason: z
        .string()
        .trim()
        .max(CALENDAR_LIMITS.maxReasonLength, 'Reason is too long.')
        .nullable()
        .optional(),
      expectedVersion: positiveVersionSchema.nullable().optional(),
      confirmOverwrite: z.boolean().optional().default(false),
    })
    .superRefine((body, context) => {
      if (body.dayType === 'holiday' && typeof body.isWorking !== 'boolean') {
        context.addIssue({
          code: 'custom',
          path: ['isWorking'],
          message: 'Holiday entries require isWorking to be specified.',
        })
      }

      if (body.dayType !== 'holiday' && body.isWorking === true) {
        context.addIssue({
          code: 'custom',
          path: ['isWorking'],
          message: 'Entries with dayType day_off or machine_not_scheduled must have isWorking set to false.',
        })
      }

      if (body.dayType !== 'holiday' && (!body.name || body.name.trim().length === 0)) {
        context.addIssue({
          code: 'custom',
          path: ['name'],
          message: 'Calendar entry name is required.',
        })
      }

      if (body.dayType === 'machine_not_scheduled' && (!body.reason || body.reason.trim().length === 0)) {
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'A reason is required when dayType is machine_not_scheduled.',
        })
      }
    }),
})

const postCalendarRangeSchema = z.object({
  params: z.strictObject({
    machineId: z.string().uuid('Invalid machine id.'),
  }),
  query: z.strictObject({}).optional().default({}),
  body: z
    .strictObject({
      startDate: businessDateSchema,
      endDate: businessDateSchema,
      dayType: z.enum(CALENDAR_RANGE_DAY_TYPES),
      name: z
        .string()
        .trim()
        .min(1, 'Range name is required.')
        .max(CALENDAR_LIMITS.maxNameLength, 'Range name is too long.'),
      reason: z
        .string()
        .trim()
        .max(CALENDAR_LIMITS.maxReasonLength, 'Reason is too long.')
        .nullable()
        .optional(),
      confirmOverwrite: z.boolean().optional().default(false),
      groupId: z.string().uuid('Invalid group id.').nullable().optional(),
    })
    .superRefine((body, context) => {
      if (body.endDate < body.startDate) {
        context.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'End date must be on or after start date.',
        })
      } else if (getInclusiveDateSpanDays(body.startDate, body.endDate) > CALENDAR_LIMITS.maxRangeDays) {
        context.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'Production calendar range must span between 1 and 62 days.',
        })
      }

      if (body.dayType === 'machine_not_scheduled' && (!body.reason || body.reason.trim().length === 0)) {
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'A reason is required when dayType is machine_not_scheduled.',
        })
      }
    }),
})

const deleteCalendarDaySchema = z.object({
  params: z.strictObject({
    machineId: z.string().uuid('Invalid machine id.'),
    calendarDate: businessDateSchema,
  }),
  query: z.strictObject({}).optional().default({}),
})

const deleteCalendarRangeSchema = z.object({
  params: z.strictObject({
    machineId: z.string().uuid('Invalid machine id.'),
    groupId: z.string().uuid('Invalid group id.'),
  }),
  query: z.strictObject({}).optional().default({}),
})

const storedCalendarDayRecordSchema = z.strictObject({
  machine_id: z.string().uuid(),
  calendar_date: z.preprocess(
    (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
    businessDateSchema,
  ),
  name: z.string().trim().min(1),
  day_type: z.enum(CALENDAR_DAY_TYPES),
  is_working: z.boolean(),
  reason: z.string().nullable(),
  source: z.enum(CALENDAR_SOURCES),
  group_id: z.string().uuid().nullable(),
  version: positiveVersionSchema,
  updated_by: z.string().uuid().nullable(),
  updated_at: z.preprocess(
    (value) => (value instanceof Date ? value.toISOString() : value),
    z.string().datetime({ offset: true }),
  ),
})

module.exports = {
  CALENDAR_DAY_TYPES,
  CALENDAR_LIMITS,
  CALENDAR_RANGE_DAY_TYPES,
  CALENDAR_SOURCES,
  businessDateSchema,
  deleteCalendarDaySchema,
  deleteCalendarRangeSchema,
  getCalendarQuerySchema,
  getInclusiveDateSpanDays,
  isValidBusinessDate,
  positiveVersionSchema,
  postCalendarRangeSchema,
  putCalendarDaySchema,
  storedCalendarDayRecordSchema,
}
