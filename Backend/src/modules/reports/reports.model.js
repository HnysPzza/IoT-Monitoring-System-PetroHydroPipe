const { z } = require('zod')

const reportCategorySchema = z.enum(['regular', 'production']).default('regular')

const reportSummarySchema = z.object({
  query: z.object({
    category: reportCategorySchema,
    type: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    date: z.string().date('Invalid report date.').optional(),
    compare: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
  }),
})

const exportReportSchema = z.object({
  body: z.object({
    category: reportCategorySchema,
    type: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    date: z.string().date('Invalid report date.').optional(),
    format: z.enum(['pdf', 'xlsx']),
  }),
})

module.exports = {
  exportReportSchema,
  reportCategorySchema,
  reportSummarySchema,
}

