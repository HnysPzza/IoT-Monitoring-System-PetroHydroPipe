const { z } = require('zod')

const overviewQuerySchema = z.object({
  query: z.object({
    trendMode: z.enum(['today', 'week', 'month']).optional(),
    date: z.string().date('Invalid overview date.').optional(),
  }),
})

const downtimeImpactQuerySchema = z.object({
  query: z.object({
    trendMode: z.enum(['today', 'week', 'month']).optional(),
    date: z.string().date('Invalid downtime impact date.').optional(),
  }),
})

module.exports = {
  downtimeImpactQuerySchema,
  overviewQuerySchema,
}
