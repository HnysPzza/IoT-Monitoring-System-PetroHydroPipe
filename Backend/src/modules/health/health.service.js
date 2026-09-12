const env = require('../../config/env')
const { getSupabaseClient } = require('../../database/client')

const EXPECTED_SCHEMA_VERSION = 42

async function checkReadiness() {
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

module.exports = { checkReadiness }
