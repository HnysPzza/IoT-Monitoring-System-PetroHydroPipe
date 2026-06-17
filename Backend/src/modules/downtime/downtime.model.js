const { z } = require('zod')

const downtimeCauseSchema = z.enum([
  'Corrective Maintenance',
  'Manual Cutting',
  'Coil Joint',
  'Weld Wire Refill',
  'Flux Refill',
  'Pending Cause Review',
])

const listDowntimeSchema = z.object({
  query: z.object({
    status: z.enum(['All', 'Open', 'Resolved']).optional(),
    cause: z.string().trim().optional(),
    date: z.string().date('Invalid downtime date.').optional(),
  }),
})

const updateDowntimeSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid downtime id.'),
  }),
  body: z.object({
    cause: downtimeCauseSchema.optional(),
    status: z.enum(['Open', 'Resolved']).optional(),
    notes: z.string().trim().max(1000, 'Notes are too long.').optional(),
  }).refine((body) => body.cause || body.status || body.notes, {
    message: 'At least one downtime field is required.',
  }),
})

module.exports = {
  listDowntimeSchema,
  updateDowntimeSchema,
}
