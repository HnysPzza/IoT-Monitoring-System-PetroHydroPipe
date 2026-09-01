const { createClient } = require('@supabase/supabase-js')
const env = require('../config/env')
const { getRequestSignal } = require('../shared/requestContext')

let supabase = null

async function requestAwareFetch(input, init = {}) {
  const requestSignal = getRequestSignal()
  if (!requestSignal) return globalThis.fetch(input, init)

  const signal = init.signal
    ? AbortSignal.any([init.signal, requestSignal])
    : requestSignal

  try {
    return await globalThis.fetch(input, { ...init, signal })
  } catch (error) {
    if (signal.aborted) {
      throw new DOMException('The request was aborted.', 'AbortError')
    }
    throw error
  }
}

function getSupabaseClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  }

  if (!supabase) {
    // Service role client is backend-only; never expose this key to the frontend.
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: requestAwareFetch,
      },
    })
  }

  return supabase
}

module.exports = {
  getSupabaseClient,
}
