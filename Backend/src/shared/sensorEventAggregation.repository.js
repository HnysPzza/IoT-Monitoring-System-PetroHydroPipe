const { getSupabaseClient } = require('../database/client')

async function aggregateSensorEvents(machineId, window, bucketSeconds) {
  const { data, error } = await getSupabaseClient().rpc('aggregate_analytics_sensor_events', {
    p_machine_id: machineId,
    p_started_at: window.start.toISOString(),
    p_ended_at: window.end.toISOString(),
    p_bucket_seconds: bucketSeconds,
  })

  if (error) {
    const aggregationError = new Error('Unable to aggregate recorded sensor events.')
    aggregationError.status = 500
    aggregationError.code = 'SENSOR_EVENT_AGGREGATION_FAILED'
    throw aggregationError
  }

  return data || []
}

module.exports = { aggregateSensorEvents }
