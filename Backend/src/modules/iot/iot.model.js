const { z } = require('zod')

const SIGNAL_BY_EVENT_TYPE = {
  pulse: 'active',
  idle: 'idle',
  downtime: 'no_pulse',
  fault: 'fault',
  recovered: 'active',
}

const RESERVED_METADATA_KEYS = ['outputAccepted', 'outputRejectionReason']
const MIN_RECORDED_AT = new Date('2026-05-01T00:00:00+08:00')
const MAX_METADATA_BYTES = 4096
const MAX_METADATA_DEPTH = 3
const MAX_METADATA_KEYS = 32

function isBoundedMetadata(metadata) {
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_METADATA_BYTES) return false
  let keyCount = 0
  function inspect(value, depth) {
    if (depth > MAX_METADATA_DEPTH) return false
    if (value === null || typeof value !== 'object') return true
    if (Array.isArray(value)) return value.every((item) => inspect(item, depth + 1))
    const keys = Object.keys(value)
    keyCount += keys.length
    if (keyCount > MAX_METADATA_KEYS) return false
    return keys.every((key) => inspect(value[key], depth + 1))
  }
  return inspect(metadata, 0)
}

const recordedAtTimestampSchema = z.string()
  .datetime({ offset: true, message: 'recordedAt must be an ISO timestamp with an offset.' })
  .refine(
    (value) => new Date(value).getTime() >= MIN_RECORDED_AT.getTime(),
    'recordedAt must not be earlier than 2026-05-01T00:00:00+08:00.',
  )

const deviceHeadersSchema = z.object({
  'x-device-id': z.string().trim()
    .min(3, 'x-device-id must be at least 3 characters.')
    .max(64, 'x-device-id must be at most 64 characters.')
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'x-device-id contains unsupported characters.'),
  'x-device-key': z.string()
    .min(1, 'x-device-key is required.')
    .max(128, 'x-device-key must be at most 128 characters.'),
})

const sensorEventSchema = z.object({
  headers: deviceHeadersSchema,
  body: z.strictObject({
    eventId: z.string().uuid('eventId must be a UUID.'),
    eventType: z.enum(['pulse', 'idle', 'downtime', 'fault', 'recovered']),
    signal: z.enum(['active', 'idle', 'no_pulse', 'fault']),
    recordedAt: recordedAtTimestampSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  }).superRefine((body, context) => {
    if (SIGNAL_BY_EVENT_TYPE[body.eventType] !== body.signal) {
      context.addIssue({
        code: 'custom',
        path: ['signal'],
        message: `Signal ${body.signal} is invalid for event type ${body.eventType}.`,
      })
    }
    for (const key of RESERVED_METADATA_KEYS) {
      if (!Object.hasOwn(body.metadata, key)) continue
      context.addIssue({
        code: 'custom',
        path: ['metadata', key],
        message: `metadata.${key} is reserved for server use.`,
      })
    }
    if (!isBoundedMetadata(body.metadata)) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'metadata exceeds allowed nesting depth, key count, or byte size.',
      })
    }
  }),
})

const deviceConfigRequestSchema = z.object({
  headers: deviceHeadersSchema,
})

const liveFeedRequestSchema = z.object({
  query: z.strictObject({}).optional().default({}),
})

module.exports = {
  MIN_RECORDED_AT,
  RESERVED_METADATA_KEYS,
  deviceConfigRequestSchema,
  deviceHeadersSchema,
  liveFeedRequestSchema,
  recordedAtTimestampSchema,
  sensorEventSchema,
}
