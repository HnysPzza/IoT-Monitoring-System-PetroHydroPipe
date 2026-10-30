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

function mapRpcError(error, fallbackCode, fallbackMessage) {
  if (error?.code === 'P0002') {
    const err = new Error(error.message || 'Production log record not found.')
    err.status = 404
    err.code = 'PRODUCTION_RECORD_NOT_FOUND'
    return err
  }

  if (error?.code === '22023') {
    const err = new Error(error.message || 'Invalid production specification update.')
    err.status = 400
    err.code = 'PRODUCTION_SPEC_INVALID'
    return err
  }

  if (error?.code === '40001') {
    const err = new Error(error.message || 'Production specification was modified by another user.')
    err.status = 409
    err.code = 'PRODUCTION_SPEC_CONFLICT'
    return err
  }

  return createRepositoryError(fallbackCode, fallbackMessage)
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

async function updateProductionSpec(
  { eventId, label, size, diameter, radius, circumference, actorUserId, expectedUpdatedAt },
  suppliedClient,
) {
  const supabase = suppliedClient || getSupabaseClient()
  const { data, error } = await supabase.rpc('update_production_log_spec', {
    p_sensor_event_id: eventId,
    p_label: label ?? null,
    p_size: size ?? null,
    p_diameter: diameter ?? null,
    p_radius: radius ?? null,
    p_circumference: circumference ?? null,
    p_actor_user_id: actorUserId,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  })

  if (error) {
    throw mapRpcError(error, 'PRODUCTION_SPEC_UPDATE_FAILED', 'Unable to update production specification.')
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    throw createRepositoryError('PRODUCTION_SPEC_UPDATE_FAILED', 'Unable to update production specification.')
  }

  return row
}

async function batchUpdateProductionSpecs(
  { sensorEventIds, startedAt, endedAt, onlyUnlabeled, label, size, diameter, radius, circumference, actorUserId },
  suppliedClient,
) {
  const supabase = suppliedClient || getSupabaseClient()
  const { data, error } = await supabase.rpc('batch_update_production_log_specs', {
    p_sensor_event_ids: sensorEventIds ?? null,
    p_started_at: startedAt ?? null,
    p_ended_at: endedAt ?? null,
    p_only_unlabeled: Boolean(onlyUnlabeled),
    p_label: label ?? null,
    p_size: size ?? null,
    p_diameter: diameter ?? null,
    p_radius: radius ?? null,
    p_circumference: circumference ?? null,
    p_actor_user_id: actorUserId,
  })

  if (error) {
    throw mapRpcError(error, 'PRODUCTION_BATCH_UPDATE_FAILED', 'Unable to batch update production specifications.')
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    throw createRepositoryError('PRODUCTION_BATCH_UPDATE_FAILED', 'Unable to batch update production specifications.')
  }

  return row
}

module.exports = {
  findOutputSensor,
  findProductionEvents,
  findProductionSpecsByEventIds,
  updateProductionSpec,
  batchUpdateProductionSpecs,
}
