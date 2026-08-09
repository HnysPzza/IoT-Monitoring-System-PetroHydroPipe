const { z } = require('zod')

const SIGNAL_BY_EVENT_TYPE = {
  pulse: 'active',
  idle: 'idle',
  downtime: 'no_pulse',
  fault: 'fault',
  recovered: 'active',
}

const sensorEventSchema = z.object({
  headers: z.object({
    'x-device-id': z.string().trim()
      .min(3, 'x-device-id must be at least 3 characters.')
      .max(64, 'x-device-id must be at most 64 characters.')
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'x-device-id contains unsupported characters.'),
    'x-device-key': z.string()
      .min(1, 'x-device-key is required.')
      .max(128, 'x-device-key must be at most 128 characters.'),
  }),
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
