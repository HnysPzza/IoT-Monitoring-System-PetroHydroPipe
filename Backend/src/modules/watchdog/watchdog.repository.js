const { getSupabaseClient } = require('../../database/client')

function createWatchdogError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function withAbort(query, signal) {
  return signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query
}

async function evaluateCycle({ evaluatedAt, mode, staleAfterSeconds, signal }) {
  let query = getSupabaseClient().rpc('evaluate_watchdog_cycle', {
    p_evaluated_at: evaluatedAt,
    p_mode: mode,
    p_stale_after_seconds: staleAfterSeconds,
  })
  query = withAbort(query, signal)
  const { data, error } = await query.single()

  if (error) throw createWatchdogError('WATCHDOG_CYCLE_QUERY_FAILED', 'Unable to evaluate the sensor watchdog cycle.')
  return data
}

module.exports = {
  evaluateCycle,
}
