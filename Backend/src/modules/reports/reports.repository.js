const { getSupabaseClient } = require('../../database/client')
const { OUTPUT_SENSOR_CODE } = require('../../shared/sensorIdentity')

const PAGE_SIZE = 500
const CHUNK_SIZE = 100

function createRepositoryError(code, message, dbError = null) {
  const error = new Error(message)
  error.status = 500
  error.code = code
  if (dbError) {
    error.cause = dbError
  }
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
    throw createRepositoryError('REPORT_PRODUCTION_SENSOR_QUERY_FAILED', 'Unable to load production sensor configuration.', error)
  }

  return data
}

async function findAcceptedCuttingEvents({ sensorId, startIso, endIso }, suppliedClient) {
  if (!sensorId) {
    throw createRepositoryError('REPORT_PRODUCTION_SENSOR_ID_REQUIRED', 'Sensor ID is required to query events.')
  }

  const supabase = suppliedClient || getSupabaseClient()
  const records = []
  // ponytail: paginated query capped at 100k events ceiling: 100000 events upgrade: cursor pagination or streaming background worker
  const MAX_PAGES = 200

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('sensor_events')
      .select('id, sensor_id, machine_id, device_event_id, event_type, recorded_at, output_accepted')
      .eq('sensor_id', sensorId)
      .eq('event_type', 'pulse')
      .eq('output_accepted', true)
      .gte('recorded_at', startIso)
      .lt('recorded_at', endIso)
      .order('recorded_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw createRepositoryError('REPORT_PRODUCTION_EVENTS_QUERY_FAILED', 'Unable to load production log records.', error)
    }

    const page = data || []
    records.push(...page)
    if (page.length < PAGE_SIZE) break
    if (from / PAGE_SIZE + 1 >= MAX_PAGES) {
      throw createRepositoryError(
        'REPORT_PRODUCTION_EVENT_LIMIT_EXCEEDED',
        'Production event query exceeded maximum limit of 100,000 events.',
      )
    }
  }

  return records
}

async function findProductionSpecsByEventIds(eventIds = [], suppliedClient) {
  const uniqueIds = Array.from(new Set((eventIds || []).filter(Boolean)))
  if (!uniqueIds.length) {
    return new Map()
  }

  const supabase = suppliedClient || getSupabaseClient()
  const rows = []

  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE)
    const { data, error } = await supabase
      .from('production_item_specs')
      .select('sensor_event_id, customer, diameter, thickness, length, pipe_number, label, size, radius, circumference, updated_at, updated_by')
      .in('sensor_event_id', chunk)

    if (error) {
      throw createRepositoryError('REPORT_PRODUCTION_SPECS_QUERY_FAILED', 'Unable to load production specifications.', error)
    }

    if (data) {
      rows.push(...data)
    }
  }

  return new Map(rows.map((row) => [row.sensor_event_id, row]))
}

async function findAcceptedCuttingEventsWithSpecs({ sensorId, startIso, endIso }, suppliedClient) {
  let resolvedSensorId = sensorId
  if (!resolvedSensorId) {
    const sensorConfig = await findOutputSensor(suppliedClient)
    if (!sensorConfig?.id) {
      throw createRepositoryError('REPORT_PRODUCTION_SENSOR_MISSING', 'Production output sensor is not configured.')
    }
    resolvedSensorId = sensorConfig.id
  }

  const events = await findAcceptedCuttingEvents({ sensorId: resolvedSensorId, startIso, endIso }, suppliedClient)
  const eventIds = events.map((event) => event.id)
  const specsMap = await findProductionSpecsByEventIds(eventIds, suppliedClient)

  return events.map((event) => ({
    ...event,
    spec: specsMap.get(event.id) || null,
  }))
}

module.exports = {
  findAcceptedCuttingEvents,
  findAcceptedCuttingEventsWithSpecs,
  findOutputSensor,
  findProductionSpecsByEventIds,
}
