const { z } = require('zod')

const SIGNAL_BY_EVENT_TYPE = {
  pulse: 'active',
  idle: 'idle',
  downtime: 'no_pulse',
  fault: 'fault',
  recovered: 'active',
}

const sensorEventSchema = z.object({
  body: z.object({
    eventId: z.string().uuid('eventId must be a UUID.'),
    eventType: z.enum(['pulse', 'idle', 'downtime', 'fault', 'recovered']),
    signal: z.enum(['active', 'idle', 'no_pulse', 'fault']),
    recordedAt: z.string().datetime('recordedAt must be an ISO timestamp.').optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  }).superRefine((body, context) => {
    if (SIGNAL_BY_EVENT_TYPE[body.eventType] !== body.signal) {
      context.addIssue({
        code: 'custom',
        path: ['signal'],
        message: `Signal ${body.signal} is invalid for event type ${body.eventType}.`,
      })
    }
  }),
})

module.exports = {
  sensorEventSchema,
}
