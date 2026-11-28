const { z } = require('zod')
const { isBusinessDateInRange } = require('../../shared/businessTime')

const businessDateSchema = (message) => z.string().date(message).refine(isBusinessDateInRange, message)

const listAuditLogsSchema = z.object({
  query: z.object({
    action: z.string().trim().max(100, 'Action filter is too long.').optional(),
    entityType: z.string().trim().max(64, 'Entity type filter is too long.').optional(),
    userId: z.string().uuid('Invalid user id.').optional(),
    dateFrom: businessDateSchema('Invalid start date.').optional(),
    dateTo: businessDateSchema('Invalid end date.').optional(),
    page: z.coerce.number().int().min(1, 'Page must be 1 or greater.').max(10000, 'Page cannot exceed 10000.').optional(),
    limit: z.coerce.number().int().min(1, 'Limit must be 1 or greater.').max(100, 'Limit cannot exceed 100.').optional(),
  }).strict().refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    message: 'Start date must be on or before end date.',
    path: ['dateFrom'],
  }),
})

module.exports = {
  listAuditLogsSchema,
}
