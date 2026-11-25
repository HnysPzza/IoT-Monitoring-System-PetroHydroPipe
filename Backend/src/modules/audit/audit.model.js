const { z } = require('zod')
const { isBusinessDateInRange } = require('../../shared/businessTime')

const businessDateSchema = (message) => z.string().date(message).refine(isBusinessDateInRange, message)

const listAuditLogsSchema = z.object({
  query: z.object({
    action: z.string().trim().optional(),
    entityType: z.string().trim().optional(),
    userId: z.string().uuid('Invalid user id.').optional(),
    dateFrom: businessDateSchema('Invalid start date.').optional(),
    dateTo: businessDateSchema('Invalid end date.').optional(),
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater.').max(10000, 'Page cannot exceed 10000.').optional(),
    limit: z.coerce.number().int().min(1, 'Limit must be 1 or greater.').max(100, 'Limit cannot exceed 100.').optional(),
  }),
})

module.exports = {
  listAuditLogsSchema,
}
