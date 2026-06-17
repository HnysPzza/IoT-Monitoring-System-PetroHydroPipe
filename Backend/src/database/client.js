const { createClient } = require('@supabase/supabase-js')
const env = require('../config/env')

let supabase = null

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
    })
  }

  return supabase
}

module.exports = {
  getSupabaseClient,
}
