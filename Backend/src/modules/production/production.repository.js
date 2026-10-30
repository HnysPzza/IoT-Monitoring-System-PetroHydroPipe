const { getSupabaseClient } = require('../../database/client')
const { OUTPUT_SENSOR_CODE } = require('../../shared/sensorIdentity')

const PAGE_SIZE = 500
const CHUNK_SIZE = 500

function createRepositoryError(code, message) {
  const error = new Error(message)
  error.status = 500
  error.code = code
  return error
}

async function findOutputSensor(suppliedClient) {
  const supabase = suppliedClient || getSupabaseClient()
  const { data, error } = await supabase
    .from('sensors')
    .select('id, sensor_code, label, machine_id, machines(id, machine_code, name)')
    .eq('sensor_code', OUTPUT_SENSOR_CODE)
    .maybeSingle()

  if (error) {
    throw createRepositoryError('PRODUCTION_SENSOR_LOOKUP_FAILED', 'Unable to load production sensor configuration.')
  }

  return data
}

async function findProductionEvents({ sensorId, startIso, endIso }, suppliedClient) {
  const supabase = suppliedClient || getSupabaseClient()
  const records = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('sensor_events')
      .select('id, sensor_id, machine_id, device_event_id, event_type, recorded_at, output_accepted, output_rejection_reason')
      .eq('sensor_id', sensorId)
      .eq('event_type', 'pulse')
      .gte('recorded_at', startIso)
      .lt('recorded_at', endIso)
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw createRepositoryError('PRODUCTION_QUERY_FAILED', 'Unable to load production log records.')
    }

    const page = data || []
    records.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return records
}

async function findProductionSpecsByEventIds(eventIds = [], suppliedClient) {
  if (!eventIds.length) {
    return new Map()
  }

  const supabase = suppliedClient || getSupabaseClient()
  const rows = []

  for (let i = 0; i < eventIds.length; i += CHUNK_SIZE) {
    const chunk = eventIds.slice(i, i + CHUNK_SIZE)
    const { data, error } = await supabase
      .from('production_item_specs')
      .select('sensor_event_id, label, size, diameter, radius, circumference, updated_at, updated_by')
      .in('sensor_event_id', chunk)

    if (error) {
      throw createRepositoryError('PRODUCTION_SPECS_QUERY_FAILED', 'Unable to load production specifications.')
    }

    if (data) {
      rows.push(...data)
    }
  }

  return new Map(rows.map((row) => [row.sensor_event_id, row]))
}

module.exports = {
  findOutputSensor,
  findProductionEvents,
  findProductionSpecsByEventIds,
}

