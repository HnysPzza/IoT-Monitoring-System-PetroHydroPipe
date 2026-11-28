const { z } = require('zod')
const { isBusinessDateInRange } = require('../../shared/businessTime')

const analyticsDateSchema = (message) => z.string().date(message).refine(isBusinessDateInRange, message)

const datedAnalyticsQuery = z.strictObject({
  startDate: analyticsDateSchema('Invalid Analytics start date.'),
  endDate: analyticsDateSchema('Invalid Analytics end date.'),
}).superRefine((query, context) => {
  const start = new Date(`${query.startDate}T00:00:00Z`)
  const end = new Date(`${query.endDate}T00:00:00Z`)
  const daysInclusive = Math.round((end - start) / 86400000) + 1
  if (daysInclusive < 1 || daysInclusive > 366) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'Analytics date range must be 1 to 366 days.',
    })
  }
})

const analyticsQuery = z.union([
  z.strictObject({ range: z.literal('all') }),
  datedAnalyticsQuery,
])

const analyticsQuerySchema = z.object({ query: analyticsQuery })

module.exports = { analyticsQuerySchema }
