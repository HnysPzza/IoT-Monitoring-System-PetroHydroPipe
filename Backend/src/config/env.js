const { z } = require('zod')

require('dotenv').config({ quiet: true })

// Defines every backend environment variable and catches invalid values at startup.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional().or(z.literal('')),
  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 characters.').optional().or(z.literal('')),
  API_REQUEST_TIMEOUT_MS: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(500).max(14_000).default(12_000),
  ),
  HEALTH_READINESS_TIMEOUT_MS: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(100).max(5_000).default(2_000),
  ),
  SERVER_SHUTDOWN_TIMEOUT_MS: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  ),
  ANALYTICS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60 * 1000),
  ANALYTICS_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  EXPORT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60 * 1000),
  EXPORT_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE: z.coerce.number().positive().max(100).default(0.05),
  IOT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60 * 1000),
  IOT_INGRESS_RATE_LIMIT: z.coerce.number().int().positive().default(300),
  IOT_DEVICE_RATE_LIMIT: z.coerce.number().int().positive().default(120),
  IOT_HEARTBEAT_EXPECTED_INTERVAL_MS: z.coerce.number().int().min(1000).max(120_000).default(10_000),
  IOT_HEARTBEAT_STALE_AFTER_MS: z.coerce.number().int().min(2000).max(600_000).default(30_000),
  WATCHDOG_MODE: z.enum(['disabled', 'observe', 'enforce']).default('disabled'),
  WATCHDOG_TICK_INTERVAL_MS: z.coerce.number().int().min(1000).max(120_000).default(5_000),
  WATCHDOG_EVALUATION_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(4_000),
  SSE_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  SSE_AUTH_REVALIDATION_INTERVAL_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60_000),
  SSE_AUTH_REVALIDATION_TIMEOUT_MS: z.coerce.number().int().positive().max(2_147_483_647).default(5_000),
  SSE_BACKPRESSURE_TIMEOUT_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60_000),
  SSE_MAX_CONNECTION_LIFETIME_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60 * 60 * 1000),
  SSE_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().positive().max(100).default(4),
  SSE_MAX_CONNECTIONS_PER_IP: z.coerce.number().int().positive().max(1_000).default(20),
  SSE_MAX_CONNECTIONS_TOTAL: z.coerce.number().int().positive().max(10_000).default(100),
  SSE_MAX_PENDING_EVENTS: z.coerce.number().int().positive().max(10_000).default(100),
  SSE_MAX_PENDING_BYTES: z.coerce.number().int().positive().max(10 * 1024 * 1024).default(256 * 1024),
  SSE_TCP_KEEPALIVE_INITIAL_DELAY_MS: z.coerce.number().int().positive().max(2_147_483_647).default(30_000),
})

function validateEnv() {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid environment configuration. ${details}`)
  }

  const env = parsed.data

  if (env.HEALTH_READINESS_TIMEOUT_MS >= env.API_REQUEST_TIMEOUT_MS) {
    if (process.env.HEALTH_READINESS_TIMEOUT_MS?.trim()) {
      throw new Error('Invalid environment configuration. HEALTH_READINESS_TIMEOUT_MS must be shorter than API_REQUEST_TIMEOUT_MS.')
    }
    env.HEALTH_READINESS_TIMEOUT_MS = env.API_REQUEST_TIMEOUT_MS - 100
  }

  if (env.SSE_AUTH_REVALIDATION_INTERVAL_MS >= env.SSE_MAX_CONNECTION_LIFETIME_MS) {
    throw new Error('Invalid environment configuration. SSE_AUTH_REVALIDATION_INTERVAL_MS must be shorter than SSE_MAX_CONNECTION_LIFETIME_MS.')
  }

  if (env.SSE_AUTH_REVALIDATION_TIMEOUT_MS >= env.SSE_AUTH_REVALIDATION_INTERVAL_MS) {
    throw new Error('Invalid environment configuration. SSE_AUTH_REVALIDATION_TIMEOUT_MS must be shorter than SSE_AUTH_REVALIDATION_INTERVAL_MS.')
  }

  if (env.SSE_BACKPRESSURE_TIMEOUT_MS >= env.SSE_MAX_CONNECTION_LIFETIME_MS) {
    throw new Error('Invalid environment configuration. SSE_BACKPRESSURE_TIMEOUT_MS must be shorter than SSE_MAX_CONNECTION_LIFETIME_MS.')
  }

  if (env.IOT_HEARTBEAT_EXPECTED_INTERVAL_MS >= env.IOT_HEARTBEAT_STALE_AFTER_MS) {
    throw new Error('Invalid environment configuration. IOT_HEARTBEAT_EXPECTED_INTERVAL_MS must be shorter than IOT_HEARTBEAT_STALE_AFTER_MS.')
  }

  if (env.WATCHDOG_TICK_INTERVAL_MS >= env.IOT_HEARTBEAT_STALE_AFTER_MS) {
    throw new Error('Invalid environment configuration. WATCHDOG_TICK_INTERVAL_MS must be shorter than IOT_HEARTBEAT_STALE_AFTER_MS.')
  }

  if (env.WATCHDOG_EVALUATION_TIMEOUT_MS >= env.WATCHDOG_TICK_INTERVAL_MS) {
    throw new Error('Invalid environment configuration. WATCHDOG_EVALUATION_TIMEOUT_MS must be shorter than WATCHDOG_TICK_INTERVAL_MS.')
  }

  const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  const invalidCorsOrigins = corsOrigins.filter((origin) => {
    try {
      new URL(origin)
      return false
    } catch {
      return true
    }
  })

  if (invalidCorsOrigins.length > 0) {
    throw new Error(`Invalid environment configuration. CORS_ORIGIN contains invalid URL(s): ${invalidCorsOrigins.join(', ')}`)
  }

  if (env.NODE_ENV === 'production') {
    // Production must fail fast if secrets are missing.
    const missing = []

    if (!env.SUPABASE_URL) missing.push('SUPABASE_URL')
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (!env.JWT_SECRET) missing.push('JWT_SECRET')

    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(', ')}`)
    }
  }

  return env
}

module.exports = validateEnv()
