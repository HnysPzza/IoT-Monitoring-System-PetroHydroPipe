const { EventEmitter } = require('node:events')
const { getSupabaseClient } = require('../../database/client')
const { formatBusinessTime, getBusinessDayRange } = require('../../shared/businessTime')
const logger = require('../../utils/logger')
const { recordAuditLog } = require('../audit/audit.service')

const LOSS_PER_DOWNTIME_MINUTE = 2.3
const MANUAL_CAUSE_REVIEW_SENSOR_CODE = 'S-03'
const downtimeEvents = new EventEmitter()
downtimeEvents.setMaxListeners(100)

function publishDowntimeEvent(type, downtime) {
  const event = { type, downtime }
  let published = true

  downtimeEvents.rawListeners('downtime').forEach((listener) => {
    try {
      listener.call(downtimeEvents, event)
    } catch {
      published = false
      logger.error('DOWNTIME_SSE_PUBLISH_FAILED', {
        downtimeId: downtime?.id || null,
        type,
      })
    }
  })

  return published
}

function subscribeToDowntimeEvents(listener) {
  downtimeEvents.on('downtime', listener)

  return () => {
    downtimeEvents.off('downtime', listener)
  }
}

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

function formatTimeLabel(value) {
  return formatBusinessTime(value, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getDurationMinutes(record) {
  if (record.duration_seconds != null) {
    return Math.round(record.duration_seconds / 60)
  }

  const endedAt = record.ended_at ? new Date(record.ended_at) : new Date()
  return Math.max(0, Math.round((endedAt.getTime() - new Date(record.started_at).getTime()) / 60000))
}

function isCauseEditableForSensor(sensorCode) {
  return sensorCode === MANUAL_CAUSE_REVIEW_SENSOR_CODE
}

function toDowntimeRecord(record) {
  const machine = getRelationRecord(record.machines)
  const sensor = getRelationRecord(record.sensors)
  const durationMinutes = getDurationMinutes(record)
  const sensorCode = sensor?.sensor_code || null
  const cause = record.cause || 'Pending Cause Review'
  const isCauseEditable = isCauseEditableForSensor(sensorCode)

  return {
    id: record.id,
    machine: machine?.name || 'Spiral Mill 01',
    sensor: sensorCode,
    sensorLabel: sensor?.label || null,
    displayLabel: sensorCode ? `${sensorCode} ${formatTimeLabel(record.started_at)}` : `Downtime ${formatTimeLabel(record.started_at)}`,
    cause,
    startedAt: record.started_at,
    endedAt: record.ended_at,
    durationMinutes,
    status: record.status,
    isOpen: record.status === 'Open',
    isCauseEditable,
    needsCauseReview: isCauseEditable && cause === 'Pending Cause Review',
    notes: record.notes || '',
    estimatedLoss: Math.round(durationMinutes * LOSS_PER_DOWNTIME_MINUTE),
  }
}

function createBaseQuery(options) {
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
    `, options)
}

async function listDowntime(filters = {}) {
  const page = filters.page || 1
  const limit = filters.limit || 25
  const from = (page - 1) * limit
  const to = from + limit - 1
  const dateRange = filters.date ? getBusinessDayRange(filters.date) : null
  let query = createBaseQuery({ count: 'exact' }).order('started_at', { ascending: false })

  if (filters.status && filters.status !== 'All') {
    query = query.eq('status', filters.status)
  }

  if (filters.cause && filters.cause !== 'All') {
    query = query.eq('cause', filters.cause)
  }

  if (dateRange) {
    query = query.gte('started_at', dateRange.start.toISOString()).lt('started_at', dateRange.end.toISOString())
  }

  const [recordsResult, summaryResult] = await Promise.all([
    query.range(from, to),
    getSupabaseClient()
      .rpc('get_downtime_summary', {
        p_status: filters.status || null,
        p_cause: filters.cause || null,
        p_started_from: dateRange?.start.toISOString() || null,
        p_started_to: dateRange?.end.toISOString() || null,
      })
      .single(),
  ])
  const { data, error, count } = recordsResult

  if (error || summaryResult.error) {
    throw createDowntimeError(500, 'DOWNTIME_QUERY_FAILED', 'Unable to load downtime records.')
  }

  const records = (data || []).map(toDowntimeRecord)
  const total = count || 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return {
    records,
    summary: {
      open: Number(summaryResult.data.open_count || 0),
      resolved: Number(summaryResult.data.resolved_count || 0),
      minutes: Number(summaryResult.data.total_minutes || 0),
      loss: Number(summaryResult.data.estimated_loss || 0),
    },
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
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
  const existingRecord = toDowntimeRecord(existing)

  if (values.cause !== undefined) {
    if (!existingRecord.isCauseEditable) {
      throw createDowntimeError(400, 'DOWNTIME_CAUSE_LOCKED', 'This downtime cause is assigned automatically by the sensor.')
    }
  }

  const { error } = await getSupabaseClient()
    .rpc('update_downtime_record', {
      p_downtime_id: downtimeId,
      p_cause: values.cause || null,
      p_notes: values.notes ?? null,
      p_has_notes: values.notes !== undefined,
      p_resolve: values.status === 'Resolved',
    })
    .single()

  if (error) {
    if (error.code === 'P0002') {
      throw createDowntimeError(404, 'DOWNTIME_NOT_FOUND', 'Downtime record not found.')
    }

    if (error.code === '22023') {
      throw createDowntimeError(400, 'DOWNTIME_CAUSE_LOCKED', 'This downtime cause is assigned automatically by the sensor.')
    }

    throw createDowntimeError(500, 'DOWNTIME_UPDATE_FAILED', 'Unable to update downtime record.')
  }

  const record = toDowntimeRecord(await fetchDowntimeById(downtimeId))
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

  publishDowntimeEvent('downtime.updated', {
    id: record.id,
    status: record.status,
    sensorCode: record.sensor,
  })

  return { record }
}

module.exports = {
  listDowntime,
  publishDowntimeEvent,
  subscribeToDowntimeEvents,
  updateDowntime,
}
