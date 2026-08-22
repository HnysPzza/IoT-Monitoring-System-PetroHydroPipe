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
const { OUTPUT_SENSOR_CODE } = require('../../shared/sensorIdentity')
const {
  attributeMachineDowntime,
  calculateMachineMetrics,
  toMinutes,
} = require('../../shared/operationalMetrics')
const { getOverlappingDowntime } = require('../downtime/downtime.repository')
const { getSettingsHistory } = require('../settings/settingsHistory.repository')

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

  const { data: outputSensor, error: sensorError } = await supabase
    .from('sensors')
    .select('id')
    .eq('machine_id', machineId)
    .eq('sensor_code', OUTPUT_SENSOR_CODE)
    .maybeSingle()

  if (sensorError) {
    throw createReportError(500, 'REPORT_OUTPUT_SENSOR_QUERY_FAILED', 'Unable to load the production output sensor.')
  }

  if (!outputSensor) {
    throw createReportError(500, 'REPORT_OUTPUT_SENSOR_NOT_FOUND', 'Production output sensor S-05 is not configured.')
  }

  const { count, error: eventError } = await supabase
    .from('sensor_events')
    .select('id', { count: 'exact', head: true })
    .eq('machine_id', machineId)
    .eq('sensor_id', outputSensor.id)
    .eq('event_type', 'pulse')
    .gte('recorded_at', window.start.toISOString())
    .lt('recorded_at', window.end.toISOString())

  if (eventError) {
    throw createReportError(500, 'REPORT_PRODUCTION_EVENT_QUERY_FAILED', 'Unable to load report production events.')
  }

  return count || 0
}

async function getSummary({ type = 'daily', date } = {}) {
  const asOf = new Date()
  const machine = await getMachine()
  const window = getWindow(type, date)
  const [productionTotal, downtimeRows, settingsHistory] = await Promise.all([
    getProductionTotal(machine.id, window),
    getOverlappingDowntime(machine.id, window),
    getSettingsHistory(machine.id, window),
  ])
  const metrics = calculateMachineMetrics({ records: downtimeRows, window, settingsHistory, asOf })
  const rows = attributeMachineDowntime({ records: downtimeRows, window, settingsHistory, asOf })
  const availabilityValue = metrics.availabilityPercent === null ? 'N/A' : `${metrics.availabilityPercent}%`

  return {
    reportType: type,
    selectedDate: date || formatBusinessDate(),
    summary: [
      { id: 'production', label: 'Production Count', value: `${formatNumber(productionTotal)} pcs`, helper: `From ${machine.name}` },
      { id: 'events', label: 'Downtime Events', value: String(downtimeRows.length), helper: 'Open and resolved events' },
      { id: 'duration', label: 'Downtime Duration', value: `${metrics.durationMinutes} min`, helper: `${metrics.unplannedMinutes} unplanned min` },
      { id: 'availability', label: 'Availability', value: availabilityValue, helper: 'Based on eligible production time' },
      { id: 'loss', label: 'Estimated Loss', value: `${metrics.estimatedLoss} pcs`, helper: 'Based on unplanned downtime' },
    ],
    metrics: {
      durationMinutes: metrics.durationMinutes,
      unplannedMinutes: metrics.unplannedMinutes,
      plannedExcludedMinutes: metrics.plannedExcludedMinutes,
      scheduledEligibleMinutes: toMinutes(metrics.scheduledEligibleSeconds),
      availabilityPercent: metrics.availabilityPercent,
      estimatedLoss: metrics.estimatedLoss,
    },
    rows,
  }
}

module.exports = {
  getSummary,
}
