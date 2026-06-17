const { getSupabaseClient } = require('../../database/client')
const { recordAuditLog } = require('../audit/audit.service')

const LOSS_PER_DOWNTIME_MINUTE = 2.3

function createDowntimeError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getRelationRecord(value) {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function getStartOfDayIso(dateValue) {
  return `${dateValue}T00:00:00.000Z`
}

function getEndOfDayIso(dateValue) {
  return `${dateValue}T23:59:59.999Z`
}

function getDurationMinutes(record) {
  if (record.duration_seconds != null) {
    return Math.round(record.duration_seconds / 60)
  }

  const endedAt = record.ended_at ? new Date(record.ended_at) : new Date()
  return Math.max(0, Math.round((endedAt.getTime() - new Date(record.started_at).getTime()) / 60000))
}

function toDowntimeRecord(record) {
  const machine = getRelationRecord(record.machines)
  const sensor = getRelationRecord(record.sensors)
  const durationMinutes = getDurationMinutes(record)

  return {
    id: record.id,
    machine: machine?.name || 'Spiral Mill 01',
    sensor: sensor?.sensor_code || null,
    cause: record.cause || 'Pending Cause Review',
    startedAt: record.started_at,
    endedAt: record.ended_at,
    durationMinutes,
    status: record.status,
    notes: record.notes || '',
    estimatedLoss: Math.round(durationMinutes * LOSS_PER_DOWNTIME_MINUTE),
  }
}

function buildSummary(records) {
  return {
    open: records.filter((record) => record.status === 'Open').length,
    resolved: records.filter((record) => record.status === 'Resolved').length,
    minutes: records.reduce((sum, record) => sum + record.durationMinutes, 0),
    loss: records.reduce((sum, record) => sum + record.estimatedLoss, 0),
  }
}

function createBaseQuery() {
  return getSupabaseClient()
    .from('downtime_events')
    .select(`
      id,
      started_at,
      ended_at,
      duration_seconds,
      cause,
      status,
      notes,
      machine_id,
      sensor_id,
      machines (
        name
      ),
      sensors (
        sensor_code,
        label
      )
    `)
}

async function listDowntime(filters = {}) {
  let query = createBaseQuery().order('started_at', { ascending: false })

  if (filters.status && filters.status !== 'All') {
    query = query.eq('status', filters.status)
  }

  if (filters.cause && filters.cause !== 'All') {
    query = query.eq('cause', filters.cause)
  }

  if (filters.date) {
    query = query.gte('started_at', getStartOfDayIso(filters.date)).lte('started_at', getEndOfDayIso(filters.date))
  }

  const { data, error } = await query

  if (error) {
    throw createDowntimeError(500, 'DOWNTIME_QUERY_FAILED', 'Unable to load downtime records.')
  }

  const records = (data || []).map(toDowntimeRecord)

  return {
    records,
    summary: buildSummary(records),
  }
}

async function fetchDowntimeById(downtimeId) {
  const { data, error } = await createBaseQuery()
    .eq('id', downtimeId)
    .maybeSingle()

  if (error) {
    throw createDowntimeError(500, 'DOWNTIME_LOOKUP_FAILED', 'Unable to load downtime record.')
  }

  if (!data) {
    throw createDowntimeError(404, 'DOWNTIME_NOT_FOUND', 'Downtime record not found.')
  }

  return data
}

async function updateDowntime({ downtimeId, values, actorUserId }) {
  const existing = await fetchDowntimeById(downtimeId)
  const updates = {}

  if (values.cause) updates.cause = values.cause
  if (values.notes !== undefined) updates.notes = values.notes

  if (values.status) {
    updates.status = values.status

    if (values.status === 'Resolved') {
      const endedAt = existing.ended_at || new Date().toISOString()
      updates.ended_at = endedAt
      updates.duration_seconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(existing.started_at).getTime()) / 1000))
    }
  }

  const { data, error } = await getSupabaseClient()
    .from('downtime_events')
    .update(updates)
    .eq('id', downtimeId)
    .select(`
      id,
      started_at,
      ended_at,
      duration_seconds,
      cause,
      status,
      notes,
      machine_id,
      sensor_id,
      machines (
        name
      ),
      sensors (
        sensor_code,
        label
      )
    `)
    .single()

  if (error) {
    throw createDowntimeError(500, 'DOWNTIME_UPDATE_FAILED', 'Unable to update downtime record.')
  }

  const record = toDowntimeRecord(data)
  await recordAuditLog({
    userId: actorUserId,
    action: 'DOWNTIME_UPDATED',
    entityType: 'downtime',
    entityId: record.id,
    metadata: {
      cause: record.cause,
      status: record.status,
      previousStatus: existing.status,
      sensorCode: record.sensor,
    },
  })

  return { record }
}

module.exports = {
  listDowntime,
  updateDowntime,
}
