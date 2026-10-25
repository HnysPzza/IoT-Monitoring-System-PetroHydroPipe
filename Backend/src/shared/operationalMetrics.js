const {
  calculateDowntimeBreakdown,
  getEligibleSeconds,
  getUnionedDowntimeSeconds,
  intersectIntervals,
} = require('./operationalTime')

function toMinutes(seconds) {
  return Math.round(seconds / 60)
}

function calculateEstimatedLoss(unplannedSeconds, lossRatePiecesPerMinute) {
  if (!Number.isFinite(lossRatePiecesPerMinute) || lossRatePiecesPerMinute <= 0) {
    const error = new Error('Output loss rate must be a positive number.')
    error.code = 'INVALID_OUTPUT_LOSS_RATE'
    throw error
  }

  return Number(((unplannedSeconds / 60) * lossRatePiecesPerMinute).toFixed(2))
}

function toRecordInterval(record, asOf) {
  const start = new Date(record.started_at)
  const end = record.ended_at ? new Date(record.ended_at) : new Date(asOf)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null
  return { start, end }
}

function createInvalidTimeError() {
  const error = new Error('Downtime record has an invalid timestamp.')
  error.status = 500
  error.code = 'DOWNTIME_RECORD_INVALID_TIME'
  return error
}

function getRecordsSpan(records, asOf) {
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY

  for (const record of records) {
    const recordStartMs = new Date(record.started_at).getTime()
    const recordEndMs = record.ended_at ? new Date(record.ended_at).getTime() : asOf.getTime()
    if (Number.isNaN(recordStartMs) || Number.isNaN(recordEndMs)) throw createInvalidTimeError()
    if (recordStartMs < startMs) startMs = recordStartMs
    if (recordEndMs > endMs) endMs = recordEndMs
  }

  return { start: new Date(startMs), end: new Date(Math.max(endMs, startMs + 1000)) }
}

function calculateRecordMetrics({ record, window, settingsHistory, asOf, lossRatePiecesPerMinute }) {
  const breakdown = calculateDowntimeBreakdown({
    record,
    windowStart: window.start,
    windowEnd: window.end,
    settingsHistory,
    asOf,
  })

  return {
    durationSeconds: breakdown.durationSeconds,
    unplannedSeconds: breakdown.unplannedSeconds,
    plannedExcludedSeconds: breakdown.plannedExcludedSeconds,
    durationMinutes: toMinutes(breakdown.durationSeconds),
    unplannedMinutes: toMinutes(breakdown.unplannedSeconds),
    plannedExcludedMinutes: toMinutes(breakdown.plannedExcludedSeconds),
    estimatedLoss: calculateEstimatedLoss(breakdown.unplannedSeconds, lossRatePiecesPerMinute),
  }
}

function calculateMachineMetrics({ records, window, settingsHistory, asOf, lossRatePiecesPerMinute }) {
  const scheduledEligibleSeconds = getEligibleSeconds({
    start: window.start,
    end: window.end,
    settingsHistory,
  })
  const downtime = getUnionedDowntimeSeconds({
    records,
    windowStart: window.start,
    windowEnd: window.end,
    settingsHistory,
    asOf,
  })
  const availableEligibleSeconds = Math.max(0, scheduledEligibleSeconds - downtime.unplannedSeconds)
  const availabilityPercent = scheduledEligibleSeconds === 0
    ? null
    : Math.max(0, Math.round((availableEligibleSeconds / scheduledEligibleSeconds) * 100))

  return {
    scheduledEligibleSeconds,
    availableEligibleSeconds,
    durationSeconds: downtime.durationSeconds,
    unplannedSeconds: downtime.unplannedSeconds,
    plannedExcludedSeconds: downtime.plannedExcludedSeconds,
    durationMinutes: toMinutes(downtime.durationSeconds),
    unplannedMinutes: toMinutes(downtime.unplannedSeconds),
    plannedExcludedMinutes: toMinutes(downtime.plannedExcludedSeconds),
    availabilityPercent,
    estimatedLoss: calculateEstimatedLoss(downtime.unplannedSeconds, lossRatePiecesPerMinute),
  }
}

function relationRecord(value) {
  return Array.isArray(value) ? value[0] || null : value || null
}

function getAttribution(record) {
  const sensor = relationRecord(record.sensors)
  return {
    cause: record.cause || 'Pending Cause Review',
    sensor: sensor?.sensor_code || 'Unassigned',
  }
}

function attributeMachineDowntime({ records, window, settingsHistory, asOf, lossRatePiecesPerMinute }) {
  const clipped = records.map((record) => {
    const interval = toRecordInterval(record, asOf)
    const overlap = interval && intersectIntervals(interval, window)
    return overlap ? { record, interval: overlap } : null
  }).filter(Boolean)
  const boundaries = new Set([window.start.getTime(), window.end.getTime()])

  clipped.forEach(({ interval }) => {
    boundaries.add(interval.start.getTime())
    boundaries.add(interval.end.getTime())
  })

  const ordered = [...boundaries].sort((left, right) => left - right)
  const grouped = new Map()

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const segment = { start: new Date(ordered[index]), end: new Date(ordered[index + 1]) }
    const active = clipped.filter(({ interval }) => interval.start < segment.end && interval.end > segment.start)
    if (active.length === 0) continue

    const attribution = active.length > 1
      ? { cause: 'Concurrent causes', sensor: 'Multiple' }
      : getAttribution(active[0].record)
    const key = `${attribution.cause}:${attribution.sensor}`
    const durationSeconds = Math.floor((segment.end - segment.start) / 1000)
    const unplannedSeconds = getEligibleSeconds({ ...segment, settingsHistory })
    const current = grouped.get(key) || {
      ...attribution,
      eventIds: new Set(),
      durationSeconds: 0,
      unplannedSeconds: 0,
      plannedExcludedSeconds: 0,
    }

    active.forEach(({ record }) => current.eventIds.add(record.id))
    current.durationSeconds += durationSeconds
    current.unplannedSeconds += unplannedSeconds
    current.plannedExcludedSeconds += durationSeconds - unplannedSeconds
    grouped.set(key, current)
  }

  return [...grouped.values()].map((row) => ({
    cause: row.cause,
    sensor: row.sensor,
    events: row.eventIds.size,
    durationMinutes: toMinutes(row.durationSeconds),
    unplannedMinutes: toMinutes(row.unplannedSeconds),
    plannedExcludedMinutes: toMinutes(row.plannedExcludedSeconds),
    estimatedLoss: calculateEstimatedLoss(row.unplannedSeconds, lossRatePiecesPerMinute),
  })).sort((left, right) => right.durationMinutes - left.durationMinutes)
}

module.exports = {
  attributeMachineDowntime,
  calculateEstimatedLoss,
  calculateMachineMetrics,
  calculateRecordMetrics,
  getRecordsSpan,
  toMinutes,
}
