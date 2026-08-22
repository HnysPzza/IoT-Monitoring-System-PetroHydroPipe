const { getSupabaseClient } = require('../../database/client')

function createWatchdogError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function withAbort(query, signal) {
  return signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query
}

async function listSensors(signal) {
  let query = getSupabaseClient()
    .from('sensor_watchdog_state')
    .select('sensor_id, sensors(sensor_code, machines(machine_code))')
    .order('sensor_id', { ascending: true })
  query = withAbort(query, signal)
  const { data, error } = await query

  if (error) throw createWatchdogError('WATCHDOG_SENSOR_QUERY_FAILED', 'Unable to load watchdog sensors.')

  return (data || []).map((row) => {
    const sensor = Array.isArray(row.sensors) ? row.sensors[0] : row.sensors
    const machine = Array.isArray(sensor?.machines) ? sensor.machines[0] : sensor?.machines
    if (!row.sensor_id || !sensor?.sensor_code || !machine?.machine_code) {
      throw createWatchdogError('WATCHDOG_SENSOR_RESULT_INVALID', 'Watchdog sensor data is invalid.')
    }
    return { sensorId: row.sensor_id, sensorCode: sensor.sensor_code, machineCode: machine.machine_code }
  })
}

async function evaluateSensor({ sensorId, evaluatedAt, mode, staleAfterSeconds, signal }) {
  let query = getSupabaseClient().rpc('evaluate_sensor_watchdog', {
    p_sensor_id: sensorId,
    p_evaluated_at: evaluatedAt,
    p_mode: mode,
    p_stale_after_seconds: staleAfterSeconds,
  })
  query = withAbort(query, signal)
  const { data, error } = await query.single()

  if (error) throw createWatchdogError('WATCHDOG_EVALUATION_FAILED', 'Unable to evaluate sensor watchdog.')
  return data
}

async function getStateCounts(signal) {
  let query = getSupabaseClient()
    .from('sensor_watchdog_state')
    .select('connectivity_state, detection_state')
  query = withAbort(query, signal)
  const { data, error } = await query

  if (error) throw createWatchdogError('WATCHDOG_STATE_QUERY_FAILED', 'Unable to load watchdog states.')

  return (data || []).reduce((counts, row) => {
    counts[row.connectivity_state] = (counts[row.connectivity_state] || 0) + 1
    counts[row.detection_state] = (counts[row.detection_state] || 0) + 1
    return counts
  }, {})
}

module.exports = {
  evaluateSensor,
  getStateCounts,
  listSensors,
}
