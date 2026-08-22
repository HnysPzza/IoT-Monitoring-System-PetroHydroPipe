const {
  calculateDowntimeBreakdown,
  getEligibleSeconds,
  getUnionedDowntimeSeconds,
  intersectIntervals,
} = require('./operationalTime')

const DEFAULT_LOSS_PER_MINUTE = 2.3

function toMinutes(seconds) {
  return Math.round(seconds / 60)
}

function calculateEstimatedLoss(unplannedSeconds, lossPerMinute = DEFAULT_LOSS_PER_MINUTE) {
  return Math.round((unplannedSeconds / 60) * lossPerMinute)
}

function toRecordInterval(record, asOf) {
  const start = new Date(record.started_at)
  const end = record.ended_at ? new Date(record.ended_at) : new Date(asOf)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null
  return { start, end }
}

function calculateRecordMetrics({ record, window, settingsHistory, asOf }) {
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
    estimatedLoss: calculateEstimatedLoss(breakdown.unplannedSeconds),
  }
}

function calculateMachineMetrics({ records, window, settingsHistory, asOf }) {
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
    estimatedLoss: calculateEstimatedLoss(downtime.unplannedSeconds),
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

function attributeMachineDowntime({ records, window, settingsHistory, asOf }) {
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
    estimatedLoss: calculateEstimatedLoss(row.unplannedSeconds),
  })).sort((left, right) => right.durationMinutes - left.durationMinutes)
}

module.exports = {
  attributeMachineDowntime,
  calculateEstimatedLoss,
  calculateMachineMetrics,
  calculateRecordMetrics,
  toMinutes,
}
