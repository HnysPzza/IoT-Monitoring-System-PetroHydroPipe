const { z } = require('zod')
const { isBusinessDateInRange } = require('../../shared/businessTime')

const reportDateSchema = z.string().date('Invalid report date.').refine(isBusinessDateInRange, 'Invalid report date.')
const reportCategorySchema = z.enum(['regular', 'production']).default('regular')

const reportSummarySchema = z.object({
  query: z.object({
    category: reportCategorySchema,
    type: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    date: reportDateSchema.optional(),
    compare: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
  }),
})

const exportReportSchema = z.object({
  body: z.object({
    category: reportCategorySchema,
    type: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    date: reportDateSchema.optional(),
    format: z.enum(['pdf', 'xlsx']),
  }),
})

module.exports = {
  exportReportSchema,
  reportCategorySchema,
  reportSummarySchema,
}

