const { getSupabaseClient } = require('../../database/client')
const {
  addBusinessDays,
  addBusinessMonths,
  formatBusinessDate,
  parseBusinessDate,
  startOfBusinessDay,
  startOfBusinessMonth,
  startOfBusinessWeek,
} = require('../../shared/businessTime')

const LOSS_PER_DOWNTIME_MINUTE = 2.3

function createReportError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getWindow(type, dateValue) {
  const date = parseBusinessDate(dateValue)

  if (type === 'monthly') {
    const start = startOfBusinessMonth(date)
    return { start, end: addBusinessMonths(start, 1) }
  }

  if (type === 'weekly') {
    const start = startOfBusinessWeek(date)
    return { start, end: addBusinessDays(start, 7) }
  }

  const start = startOfBusinessDay(date)
  return { start, end: addBusinessDays(start, 1) }
}

function getRelationRecord(value) {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function getDurationMinutes(record) {
  if (record.duration_seconds != null) {
    return Math.round(record.duration_seconds / 60)
  }

  const endedAt = record.ended_at ? new Date(record.ended_at) : new Date()
  return Math.max(0, Math.round((endedAt.getTime() - new Date(record.started_at).getTime()) / 60000))
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-PH')
}

async function getMachine() {
  const { data, error } = await getSupabaseClient()
    .from('machines')
    .select('id, name')
    .eq('machine_code', 'M-01')
    .maybeSingle()

  if (error) {
    throw createReportError(500, 'REPORT_MACHINE_QUERY_FAILED', 'Unable to load report machine.')
  }

  if (!data) {
    throw createReportError(404, 'MACHINE_NOT_FOUND', 'Spiral Mill 01 was not found.')
  }

  return data
}

async function getProductionTotal(machineId, window) {
  const supabase = getSupabaseClient()
  const { data: counts, error: countError } = await supabase
    .from('production_counts')
    .select('count_value')
    .eq('machine_id', machineId)
    .gte('window_start', window.start.toISOString())
    .lt('window_start', window.end.toISOString())

  if (countError) {
    throw createReportError(500, 'REPORT_PRODUCTION_QUERY_FAILED', 'Unable to load report production counts.')
  }

  const countTotal = (counts || []).reduce((sum, row) => sum + Number(row.count_value || 0), 0)

  if (countTotal > 0) {
    return countTotal
  }

  const { count, error: eventError } = await supabase
    .from('sensor_events')
    .select('id', { count: 'exact', head: true })
    .eq('machine_id', machineId)
    .eq('event_type', 'pulse')
    .gte('recorded_at', window.start.toISOString())
    .lt('recorded_at', window.end.toISOString())

  if (eventError) {
    throw createReportError(500, 'REPORT_PRODUCTION_EVENT_QUERY_FAILED', 'Unable to load report production events.')
  }

  return count || 0
}

async function getDowntimeRows(machineId, window) {
  const { data, error } = await getSupabaseClient()
    .from('downtime_events')
    .select(`
      id,
      started_at,
      ended_at,
      duration_seconds,
      cause,
      status,
      sensor_id,
      sensors (
        sensor_code
      )
    `)
    .eq('machine_id', machineId)
    .gte('started_at', window.start.toISOString())
    .lt('started_at', window.end.toISOString())

  if (error) {
    throw createReportError(500, 'REPORT_DOWNTIME_QUERY_FAILED', 'Unable to load report downtime.')
  }

  return data || []
}

function groupDowntimeRows(rows) {
  const grouped = new Map()

  rows.forEach((record) => {
    const sensor = getRelationRecord(record.sensors)
    const cause = record.cause || 'Pending Cause Review'
    const sensorCode = sensor?.sensor_code || 'Unassigned'
    const key = `${cause}:${sensorCode}`
    const durationMinutes = getDurationMinutes(record)
    const existing = grouped.get(key) || {
      cause,
      sensor: sensorCode,
      events: 0,
      durationMinutes: 0,
      estimatedLoss: 0,
    }

    existing.events += 1
    existing.durationMinutes += durationMinutes
    existing.estimatedLoss += Math.round(durationMinutes * LOSS_PER_DOWNTIME_MINUTE)
    grouped.set(key, existing)
  })

  return Array.from(grouped.values()).sort((left, right) => right.durationMinutes - left.durationMinutes)
}

async function getSummary({ type = 'daily', date } = {}) {
  const machine = await getMachine()
  const window = getWindow(type, date)
  const [productionTotal, downtimeRows] = await Promise.all([
    getProductionTotal(machine.id, window),
    getDowntimeRows(machine.id, window),
  ])
  const rows = groupDowntimeRows(downtimeRows)
  const downtimeMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0)
  const estimatedLoss = rows.reduce((sum, row) => sum + row.estimatedLoss, 0)
  const availability = Math.max(0, Math.round(100 - (downtimeMinutes / ((window.end.getTime() - window.start.getTime()) / 60000)) * 100))

  return {
    reportType: type,
    selectedDate: date || formatBusinessDate(),
    summary: [
      { id: 'production', label: 'Production Count', value: `${formatNumber(productionTotal)} pcs`, helper: `From ${machine.name}` },
      { id: 'events', label: 'Downtime Events', value: String(downtimeRows.length), helper: 'Open and resolved events' },
      { id: 'duration', label: 'Downtime Duration', value: `${downtimeMinutes} min`, helper: 'Total recorded downtime' },
      { id: 'availability', label: 'Availability', value: `${availability}%`, helper: 'Estimated from recorded downtime' },
      { id: 'loss', label: 'Estimated Loss', value: `${estimatedLoss} pcs`, helper: 'Based on downtime duration' },
    ],
    rows,
  }
}

module.exports = {
  getSummary,
}
