const { getSupabaseClient } = require('../../database/client')

const PAGE_SIZE = 500
const METRIC_COLUMNS = `
  id,
  machine_id,
  sensor_id,
  started_at,
  ended_at,
  cause,
  status,
  sensors (sensor_code)
`

function createRepositoryError(code, message) {
  const error = new Error(message)
  error.status = 500
  error.code = code
  return error
}

async function getOverlappingDowntime(machineId, window, suppliedClient) {
  const supabase = suppliedClient || getSupabaseClient()
  const records = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('downtime_events')
      .select(METRIC_COLUMNS)
      .eq('machine_id', machineId)
      .lt('started_at', window.end.toISOString())
      .or(`ended_at.is.null,ended_at.gt.${window.start.toISOString()}`)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw createRepositoryError('DOWNTIME_METRIC_QUERY_FAILED', 'Unable to load overlapping downtime records.')
    }

    const page = data || []
    records.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return records
}

module.exports = { getOverlappingDowntime }
