const { z } = require('zod')

const reportSummarySchema = z.object({
  query: z.object({
    type: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    date: z.string().date('Invalid report date.').optional(),
  }),
})

const exportReportSchema = z.object({
  body: z.object({
    type: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    date: z.string().date('Invalid report date.').optional(),
    format: z.enum(['csv', 'pdf']),
  }),
})

module.exports = {
  exportReportSchema,
  reportSummarySchema,
}
