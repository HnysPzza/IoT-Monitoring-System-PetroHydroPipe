const { z } = require('zod')
const { isBusinessDateInRange } = require('../../shared/businessTime')

const businessDateSchema = (message) => z.string().date(message).refine(isBusinessDateInRange, message)

const overviewQuerySchema = z.object({
  query: z.object({
    trendMode: z.enum(['today', 'week', 'month']).optional(),
    date: businessDateSchema('Invalid overview date.').optional(),
  }).strict(),
})

const downtimeImpactQuerySchema = z.object({
  query: z.object({
    trendMode: z.enum(['today', 'week', 'month']).optional(),
    date: businessDateSchema('Invalid downtime impact date.').optional(),
  }).strict(),
})

module.exports = {
  downtimeImpactQuerySchema,
  overviewQuerySchema,
}
