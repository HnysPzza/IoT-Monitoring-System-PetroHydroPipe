const env = require('../../config/env')
const { getSupabaseClient } = require('../../database/client')

const EXPECTED_SCHEMA_VERSION = 64
const READINESS_SUCCESS_TTL_MS = 5_000
const READINESS_FAILURE_TTL_MS = 2_000

// ponytail: process-local 5s readiness cache and single-flight promise; move to shared cache before multi-instance.
let cachedResult = null
let inFlightCheck = null

async function runReadinessProbe() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.HEALTH_READINESS_TIMEOUT_MS)
  timeout.unref?.()

  try {
    const { data, error } = await getSupabaseClient()
      .rpc('get_backend_readiness')
      .abortSignal(controller.signal)

    if (error) throw error
    if (data !== EXPECTED_SCHEMA_VERSION) {
      const schemaError = new Error('Database schema is incompatible.')
      schemaError.code = 'DATABASE_SCHEMA_INCOMPATIBLE'
      throw schemaError
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function checkReadiness() {
  const now = Date.now()
  if (cachedResult && cachedResult.expiresAt > now) {
    if (cachedResult.ok) return
    throw cachedResult.error
  }

  if (!inFlightCheck) {
    inFlightCheck = runReadinessProbe()
      .then(() => {
        cachedResult = { ok: true, error: null, expiresAt: Date.now() + READINESS_SUCCESS_TTL_MS }
      })
      .catch((error) => {
        cachedResult = { ok: false, error, expiresAt: Date.now() + READINESS_FAILURE_TTL_MS }
        throw error
      })
      .finally(() => {
        inFlightCheck = null
      })
  }

  return inFlightCheck
}

module.exports = { checkReadiness }
