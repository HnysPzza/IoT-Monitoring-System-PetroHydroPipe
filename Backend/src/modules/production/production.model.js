const { z } = require('zod')

const DAY_MS = 24 * 60 * 60 * 1000

const listProductionLogsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater.').default(1),
    pageSize: z.coerce.number().int().min(1, 'Page size must be 1 or greater.').max(100, 'Page size cannot exceed 100.').optional(),
    limit: z.coerce.number().int().min(1, 'Limit must be 1 or greater.').max(100, 'Limit cannot exceed 100.').optional(),
    date: z.string().date('Invalid production date.').optional(),
    dateFrom: z.string().date('Invalid start date.').optional(),
    dateTo: z.string().date('Invalid end date.').optional(),
    status: z.enum(['accepted', 'rejected', 'all']).default('accepted'),
    specStatus: z.enum(['all', 'specified', 'unspecified']).default('all'),
    search: z.string().trim().max(100, 'Search query is too long.').optional(),
  }).strict().refine((data) => {
    if (data.date && (data.dateFrom || data.dateTo)) {
      return false
    }
    return true
  }, {
    message: 'Provide either a single date or a date range, not both.',
  }).refine((data) => {
    if (data.dateFrom && data.dateTo && data.dateFrom > data.dateTo) {
      return false
    }
    return true
  }, {
    message: 'Start date cannot be after end date.',
  }).refine((data) => {
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

module.exports = {
  listProductionLogsSchema,
}
