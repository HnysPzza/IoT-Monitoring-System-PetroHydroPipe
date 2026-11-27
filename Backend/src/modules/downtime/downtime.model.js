const { z } = require('zod')
const { isBusinessDateInRange } = require('../../shared/businessTime')

const businessDateSchema = (message) => z.string().date(message).refine(isBusinessDateInRange, message)

const downtimeCauseSchema = z.enum([
  'Corrective Maintenance',
  'Manual Cutting',
  'Misalignment',
  'Consumable Shortage',
  'Hydraulic Failure',
  'Electrical Failure',
  'Crane Failure',
  'Other',
])

const listDowntimeSchema = z.object({
  query: z.object({
    status: z.enum(['All', 'Open', 'Resolved']).optional(),
    cause: z.string().trim().optional(),
    date: businessDateSchema('Invalid downtime date.').optional(),
    dateFrom: businessDateSchema('Invalid start date.').optional(),
    dateTo: businessDateSchema('Invalid end date.').optional(),
    page: z.coerce.number().int().positive().max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    message: 'Start date must be on or before end date.',
    path: ['dateFrom'],
  }).refine(
    (query) => !query.dateFrom || !query.dateTo
      || (Date.parse(`${query.dateTo}T00:00:00Z`) - Date.parse(`${query.dateFrom}T00:00:00Z`)) <= 366 * 86_400_000,
    {
      message: 'Date range cannot exceed 366 days.',
      path: ['dateTo'],
    },
  ),
})

const updateDowntimeSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid downtime id.'),
  }),
  body: z.object({
    cause: downtimeCauseSchema.optional(),
    notes: z.string().trim().max(1000, 'Notes are too long.').optional(),
  }).strict().refine((body) => body.cause !== undefined || body.notes !== undefined, {
    message: 'At least one downtime field is required.',
  }),
})

module.exports = {
  listDowntimeSchema,
  updateDowntimeSchema,
}
