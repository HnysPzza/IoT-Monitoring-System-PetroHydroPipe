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
  IOT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60 * 1000),
  IOT_INGRESS_RATE_LIMIT: z.coerce.number().int().positive().default(300),
  IOT_DEVICE_RATE_LIMIT: z.coerce.number().int().positive().default(120),
  SSE_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().max(2_147_483_647).default(30_000),
  SSE_AUTH_REVALIDATION_INTERVAL_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60_000),
  SSE_AUTH_REVALIDATION_TIMEOUT_MS: z.coerce.number().int().positive().max(2_147_483_647).default(5_000),
  SSE_MAX_CONNECTION_LIFETIME_MS: z.coerce.number().int().positive().max(2_147_483_647).default(60 * 60 * 1000),
  SSE_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().positive().max(100).default(2),
  SSE_MAX_CONNECTIONS_PER_IP: z.coerce.number().int().positive().max(1_000).default(5),
  SSE_MAX_CONNECTIONS_TOTAL: z.coerce.number().int().positive().max(10_000).default(100),
  SSE_MAX_PENDING_EVENTS: z.coerce.number().int().positive().max(10_000).default(100),
  SSE_MAX_PENDING_BYTES: z.coerce.number().int().positive().max(10 * 1024 * 1024).default(256 * 1024),
})

function validateEnv() {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Invalid environment configuration. ${details}`)
  }

  const env = parsed.data

  if (env.SSE_AUTH_REVALIDATION_INTERVAL_MS >= env.SSE_MAX_CONNECTION_LIFETIME_MS) {
    throw new Error('Invalid environment configuration. SSE_AUTH_REVALIDATION_INTERVAL_MS must be shorter than SSE_MAX_CONNECTION_LIFETIME_MS.')
  }

  if (env.SSE_AUTH_REVALIDATION_TIMEOUT_MS >= env.SSE_AUTH_REVALIDATION_INTERVAL_MS) {
    throw new Error('Invalid environment configuration. SSE_AUTH_REVALIDATION_TIMEOUT_MS must be shorter than SSE_AUTH_REVALIDATION_INTERVAL_MS.')
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
