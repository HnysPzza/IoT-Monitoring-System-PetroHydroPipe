const { z } = require('zod')

const DAY_MS = 24 * 60 * 60 * 1000

const label = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
  z.string().trim().min(1).max(100, 'Specification label cannot exceed 100 characters.').nullable().optional(),
)

const size = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
  z.string().trim().min(1).max(50, 'Specification size cannot exceed 50 characters.').nullable().optional(),
)

const customer = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
  z.string().trim().min(1).max(100, 'Customer name cannot exceed 100 characters.').nullable().optional(),
)

const pipeNumber = z.preprocess(
  (val) => {
    if (val === undefined) return undefined
    if (val === null) return null
    if (typeof val === 'string') {
      const trimmed = val.trim()
      return trimmed === '' ? null : Number(trimmed)
    }
    if (typeof val === 'number') {
      return val
    }
    return NaN
  },
  z
    .number()
    .int('Pipe number must be an integer.')
    .gt(0, 'Pipe number must be greater than zero.')
    .nullable()
    .optional(),
)

const dimension = z.preprocess(
  (val) => {
    if (val === undefined) return undefined
    if (val === null) return null
    if (typeof val === 'string') {
      return val.trim() === '' ? null : Number(val)
    }
    if (typeof val === 'number') {
      return val
    }
    return NaN
  },
  z
    .number()
    .finite()
    .gt(0, 'Dimension must be greater than zero.')
    .max(99999999.99, 'Dimension cannot exceed 99999999.99.')
    .refine((n) => Math.round(n * 100) / 100 > 0, 'Dimension rounded to 2 decimal places must be greater than zero.')
    .nullable()
    .optional(),
)

const tonnage = z.preprocess(
  (val) => {
    if (val === undefined) return undefined
    if (val === null) return null
    if (typeof val === 'string') {
      return val.trim() === '' ? null : Number(val)
    }
    if (typeof val === 'number') {
      return val
    }
    return NaN
  },
  z
    .number()
    .finite()
    .gt(0, 'Tonnage must be greater than zero.')
    .max(99999999.99, 'Tonnage cannot exceed 99999999.99.')
    .refine((n) => Math.round(n * 10000) / 10000 > 0, 'Tonnage rounded to 4 decimal places must be greater than zero.')
    .nullable()
    .optional(),
)

const listProductionLogsSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be 1 or greater.').default(1),
      pageSize: z.coerce.number().int().min(1, 'Page size must be 1 or greater.').max(100, 'Page size cannot exceed 100.').optional(),
      limit: z.coerce.number().int().min(1, 'Limit must be 1 or greater.').max(100, 'Limit cannot exceed 100.').optional(),
      date: z.string().date('Invalid production date.').optional(),
      dateFrom: z.string().date('Invalid start date.').optional(),
      dateTo: z.string().date('Invalid end date.').optional(),
      status: z.enum(['accepted', 'rejected', 'all']).default('accepted'),
      specStatus: z.enum(['all', 'specified', 'unspecified']).default('all'),
      search: z.string().trim().max(100, 'Search query is too long.').optional(),
    })
    .strict()
    .refine((data) => {
      if (data.date && (data.dateFrom || data.dateTo)) {
        return false
      }
      return true
    }, {
      message: 'Provide either a single date or a date range, not both.',
    })
    .refine((data) => {
      if (data.dateFrom && data.dateTo && data.dateFrom > data.dateTo) {
        return false
      }
      return true
    }, {
      message: 'Start date cannot be after end date.',
    })
    .refine((data) => {
      if (data.dateFrom && data.dateTo) {
        const from = new Date(`${data.dateFrom}T00:00:00Z`).getTime()
        const to = new Date(`${data.dateTo}T00:00:00Z`).getTime()
        if ((to - from) / DAY_MS > 366) {
          return false
        }
      }
      return true
    }, {
      message: 'Date range cannot exceed 366 days.',
    }),
})

const updateProductionSpecBodySchema = z
  .object({
    customer,
    diameter: dimension,
    thickness: dimension,
    length: dimension,
    pipeNumber,
    tonnage,
    expectedUpdatedAt: z
      .string()
      .datetime({ offset: true, message: 'Invalid expectedUpdatedAt timestamp.' })
      .nullable()
      .optional(),
    label,
    size,
    radius: dimension,
    circumference: dimension,
  })
  .strict()
  .refine(
    (data) => {
      return (
        data.customer !== undefined ||
        data.diameter !== undefined ||
        data.thickness !== undefined ||
        data.length !== undefined ||
        data.pipeNumber !== undefined ||
        data.tonnage !== undefined ||
        data.label !== undefined ||
        data.size !== undefined ||
        data.radius !== undefined ||
        data.circumference !== undefined
      )
    },
    {
      message: 'Provide at least one specification field to update.',
    },
  )

const updateProductionSpecSchema = z.object({
  params: z
    .object({
      eventId: z.string().uuid('Invalid production event ID.'),
    })
    .strict(),
  body: updateProductionSpecBodySchema,
})

const batchUpdateBodySchema = z
  .object({
    sensorEventIds: z
      .array(z.string().uuid('Invalid production event ID.'))
      .min(1, 'Select at least one production record.')
      .max(500, 'Batch specification update cannot exceed 500 records.')
      .optional(),
    startedAt: z.string().datetime({ offset: true, message: 'Invalid start timestamp.' }).optional(),
    endedAt: z.string().datetime({ offset: true, message: 'Invalid end timestamp.' }).optional(),
    dateFrom: z.string().date('Invalid start date.').optional(),
    dateTo: z.string().date('Invalid end date.').optional(),
    onlyUnlabeled: z.boolean().default(false),
    customer,
    diameter: dimension,
    thickness: dimension,
    length: dimension,
    tonnage,
    label,
    size,
    radius: dimension,
    circumference: dimension,
  })
  .strict()
  .refine((data) => {
    const hasIds = Array.isArray(data.sensorEventIds) && data.sensorEventIds.length > 0
    const hasIsoRange = Boolean(data.startedAt && data.endedAt)
    const hasDateRange = Boolean(data.dateFrom && data.dateTo)
    const hasAnyIso = Boolean(data.startedAt || data.endedAt)
    const hasAnyDate = Boolean(data.dateFrom || data.dateTo)

    if (hasIds) {
      return !hasAnyIso && !hasAnyDate
    }

    if (hasIsoRange) {
      return !hasAnyDate
    }

    if (hasDateRange) {
      return !hasAnyIso
    }

    return false
  }, {
    message: 'Provide either sensorEventIds or a valid time range, not both.',
  })
  .refine((data) => {
    if (data.startedAt && data.endedAt) {
      return new Date(data.startedAt).getTime() < new Date(data.endedAt).getTime()
    }
    if (data.dateFrom && data.dateTo) {
      if (data.dateFrom > data.dateTo) {
        return false
      }
      const from = new Date(`${data.dateFrom}T00:00:00Z`).getTime()
      const to = new Date(`${data.dateTo}T00:00:00Z`).getTime()
      if ((to - from) / DAY_MS > 366) {
        return false
      }
      return true
    }
    return true
  }, {
    message: 'Start of range must be earlier than end of range.',
  })
  .refine((data) => {
    return (
      data.customer != null ||
      data.diameter != null ||
      data.thickness != null ||
      data.length != null ||
      data.tonnage != null ||
      data.label != null ||
      data.size != null ||
      data.radius != null ||
      data.circumference != null
    )
  }, {
    message: 'Provide at least one specification field to update.',
  })

const batchUpdateProductionSpecSchema = z.object({
  body: batchUpdateBodySchema,
})

module.exports = {
  customer,
  pipeNumber,
  dimension,
  tonnage,
  listProductionLogsSchema,
  updateProductionSpecBodySchema,
  updateProductionSpecSchema,
  batchUpdateBodySchema,
  batchUpdateProductionSpecsBodySchema: batchUpdateBodySchema,
  batchUpdateProductionSpecSchema,
}
