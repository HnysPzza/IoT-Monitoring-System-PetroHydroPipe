const { EventEmitter } = require('node:events')
const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const { formatBusinessTime, getBusinessDayRange } = require('../../shared/businessTime')
const { calculateMachineMetrics, calculateRecordMetrics } = require('../../shared/operationalMetrics')
const logger = require('../../utils/logger')
const { recordAuditLog } = require('../audit/audit.service')
const { getSettingsHistory } = require('../settings/settingsHistory.repository')
const { getOutputLossBasis } = require('../../shared/outputLossBasis')

const METRIC_PAGE_SIZE = 500
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

function toDowntimeRecord(record, operationalMetrics) {
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
    durationMinutes: operationalMetrics?.durationMinutes ?? durationMinutes,
    unplannedMinutes: operationalMetrics?.unplannedMinutes ?? durationMinutes,
    plannedExcludedMinutes: operationalMetrics?.plannedExcludedMinutes ?? 0,
    status: record.status,
    isOpen: record.status === 'Open',
    isCauseEditable,
    needsCauseReview: isCauseEditable && cause === 'Pending Cause Review',
    notes: record.notes || '',
    estimatedLoss: operationalMetrics?.estimatedLoss ?? null,
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

function applyListFilters(query, filters, dateRange) {
  let filtered = query

  if (filters.status && filters.status !== 'All') filtered = filtered.eq('status', filters.status)
  if (filters.cause && filters.cause !== 'All') filtered = filtered.eq('cause', filters.cause)
  if (dateRange) {
    filtered = filtered
      .lt('started_at', dateRange.end.toISOString())
      .or(`ended_at.is.null,ended_at.gt.${dateRange.start.toISOString()}`)
  }

  return filtered
}

async function getAllFilteredRecords(filters, dateRange) {
  const records = []

  for (let from = 0; ; from += METRIC_PAGE_SIZE) {
    const query = applyListFilters(
      createBaseQuery().order('started_at', { ascending: true }).order('id', { ascending: true }),
      filters,
      dateRange,
    )
    const { data, error } = await query.range(from, from + METRIC_PAGE_SIZE - 1)

    if (error) throw createDowntimeError(500, 'DOWNTIME_QUERY_FAILED', 'Unable to load downtime records.')
    const page = data || []
    records.push(...page)
    if (page.length < METRIC_PAGE_SIZE) break
  }

  return records
}

function getRecordWindow(records, asOf) {
  const starts = records.map((record) => new Date(record.started_at).getTime())
  const ends = records.map((record) => (
    record.ended_at ? new Date(record.ended_at).getTime() : asOf.getTime()
  ))
  const start = new Date(Math.min(...starts))
  const latestEnd = Math.max(...ends)
  const end = new Date(Math.max(latestEnd, start.getTime() + 1000))
  return { start, end }
}

async function calculateListMetrics(records, pageRecords, dateRange, asOf, lossEstimateBasis) {
  const recordMetrics = new Map()
  const pageIds = new Set(pageRecords.map((record) => record.id))
  const machineTotals = []
  const recordsByMachine = new Map()
  records.forEach((record) => {
    const grouped = recordsByMachine.get(record.machine_id) || []
    grouped.push(record)
    recordsByMachine.set(record.machine_id, grouped)
  })

  for (const [machineId, machineRecords] of recordsByMachine) {
    const recordWindow = getRecordWindow(machineRecords, asOf)
    const historyWindow = dateRange ? {
      start: dateRange.start < recordWindow.start ? dateRange.start : recordWindow.start,
      end: dateRange.end > recordWindow.end ? dateRange.end : recordWindow.end,
    } : recordWindow
    const settingsHistory = await getSettingsHistory(machineId, historyWindow)
    const positiveRecords = machineRecords.filter((record) => {
      const endedAt = record.ended_at ? new Date(record.ended_at) : asOf
      return new Date(record.started_at) < endedAt
    })

    machineRecords.filter((record) => pageIds.has(record.id)).forEach((record) => {
      const endedAt = record.ended_at ? new Date(record.ended_at) : asOf
      if (new Date(record.started_at) >= endedAt) {
        recordMetrics.set(record.id, {
          durationMinutes: 0,
          unplannedMinutes: 0,
          plannedExcludedMinutes: 0,
          estimatedLoss: 0,
        })
      } else {
        recordMetrics.set(record.id, calculateRecordMetrics({
          record,
          window: recordWindow,
          settingsHistory,
          asOf,
          lossRatePiecesPerMinute: lossEstimateBasis.ratePiecesPerMinute,
        }))
      }
    })
    machineTotals.push(calculateMachineMetrics({
      records: positiveRecords,
      window: dateRange || recordWindow,
      settingsHistory,
      asOf,
      lossRatePiecesPerMinute: lossEstimateBasis.ratePiecesPerMinute,
    }))
  }

  return {
    recordMetrics,
    durationMinutes: machineTotals.reduce((sum, metric) => sum + metric.durationMinutes, 0),
    unplannedMinutes: machineTotals.reduce((sum, metric) => sum + metric.unplannedMinutes, 0),
    plannedExcludedMinutes: machineTotals.reduce((sum, metric) => sum + metric.plannedExcludedMinutes, 0),
    estimatedLoss: machineTotals.reduce((sum, metric) => sum + metric.estimatedLoss, 0),
  }
}

async function listDowntime(filters = {}) {
  const asOf = new Date()
  const page = filters.page || 1
  const limit = filters.limit || 25
  const from = (page - 1) * limit
  const dateRange = filters.date ? getBusinessDayRange(filters.date) : null
  const allRecords = await getAllFilteredRecords(filters, dateRange)
  const ordered = [...allRecords].sort((left, right) => (
    new Date(right.started_at) - new Date(left.started_at) || String(right.id).localeCompare(String(left.id))
  ))
  const pageRecords = ordered.slice(from, from + limit)
  const lossEstimateBasis = allRecords.length === 0
    ? null
    : await getOutputLossBasis({
      machineId: allRecords[0].machine_id,
      asOf,
      fallbackRatePiecesPerMinute: env.OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE,
    })
  const metrics = allRecords.length === 0
    ? { recordMetrics: new Map(), durationMinutes: 0, unplannedMinutes: 0, plannedExcludedMinutes: 0, estimatedLoss: 0 }
    : await calculateListMetrics(allRecords, pageRecords, dateRange, asOf, lossEstimateBasis)
  const records = pageRecords
    .map((record) => toDowntimeRecord(record, metrics.recordMetrics.get(record.id)))
  const total = allRecords.length
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return {
    records,
    lossEstimateBasis,
    summary: {
      open: allRecords.filter((record) => record.status === 'Open').length,
      resolved: allRecords.filter((record) => record.status === 'Resolved').length,
      minutes: metrics.durationMinutes,
      unplannedMinutes: metrics.unplannedMinutes,
      plannedExcludedMinutes: metrics.plannedExcludedMinutes,
      loss: metrics.estimatedLoss,
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
  if (values.status !== undefined) {
    throw createDowntimeError(400, 'DOWNTIME_SENSOR_MANAGED', 'Downtime is resolved only by accepted sensor recovery.')
  }

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
      p_resolve: false,
    })
    .single()

  if (error) {
    if (error.code === 'P0002') {
      throw createDowntimeError(404, 'DOWNTIME_NOT_FOUND', 'Downtime record not found.')
    }

    if (error.code === '22023') {
      throw createDowntimeError(400, 'DOWNTIME_CAUSE_LOCKED', 'This downtime cause is assigned automatically by the sensor.')
    }

    if (error.code === '23514') {
      throw createDowntimeError(400, 'DOWNTIME_CAUSE_REQUIRED', 'Choose the downtime cause before resolving this record.')
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
