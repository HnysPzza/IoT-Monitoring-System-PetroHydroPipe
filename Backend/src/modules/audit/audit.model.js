const { z } = require('zod')

const listAuditLogsSchema = z.object({
  query: z.object({
    action: z.string().trim().optional(),
    entityType: z.string().trim().optional(),
    userId: z.string().uuid('Invalid user id.').optional(),
    dateFrom: z.string().date('Invalid start date.').optional(),
    dateTo: z.string().date('Invalid end date.').optional(),
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater.').optional(),
    limit: z.coerce.number().int().min(1, 'Limit must be 1 or greater.').max(100, 'Limit cannot exceed 100.').optional(),
  }),
})

module.exports = {
  listAuditLogsSchema,
}
