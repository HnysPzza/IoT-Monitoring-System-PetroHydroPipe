const { z } = require('zod')
const { deviceHeadersSchema } = require('./iot.model')

const positiveDecimalString = z.string()
  .regex(/^[1-9]\d*$/, 'Value must be a positive decimal string.')
  .max(19, 'Value exceeds the supported bigint range.')
  .refine((value) => {
    if (!/^[1-9]\d{0,18}$/.test(value)) return false
    return BigInt(value) <= 9_223_372_036_854_775_807n
  }, 'Value exceeds the supported bigint range.')

const heartbeatSchema = z.object({
  headers: deviceHeadersSchema,
  body: z.strictObject({
    heartbeatId: z.string().uuid('heartbeatId must be a UUID.'),
    bootId: z.string().uuid('bootId must be a UUID.'),
    bootCounter: positiveDecimalString,
    sequence: positiveDecimalString,
    recordedAt: z.string().datetime({ offset: true, message: 'recordedAt must be an ISO timestamp with an offset.' }),
    activityObserved: z.boolean(),
  }),
})

module.exports = {
  heartbeatSchema,
  positiveDecimalString,
}
