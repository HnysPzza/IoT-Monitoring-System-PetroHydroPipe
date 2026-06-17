const { z } = require('zod')

const reportSummarySchema = z.object({
  query: z.object({
    type: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    date: z.string().date('Invalid report date.').optional(),
  }),
})

module.exports = {
  reportSummarySchema,
}
