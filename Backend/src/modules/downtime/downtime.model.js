const { z } = require('zod')

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
    date: z.string().date('Invalid downtime date.').optional(),
    dateFrom: z.string().date('Invalid start date.').optional(),
    dateTo: z.string().date('Invalid end date.').optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    message: 'Start date must be on or before end date.',
    path: ['dateFrom'],
  }),
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
