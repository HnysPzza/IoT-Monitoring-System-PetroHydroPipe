const { z } = require('zod')

const sensorEventSchema = z.object({
  body: z.object({
    eventType: z.enum(['pulse', 'idle', 'downtime', 'fault', 'recovered']),
    signal: z.enum(['active', 'idle', 'no_pulse', 'fault']),
    recordedAt: z.string().datetime('recordedAt must be an ISO timestamp.').optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  }),
})

module.exports = {
  sensorEventSchema,
}
