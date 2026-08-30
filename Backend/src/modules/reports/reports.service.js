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
const { getSensorLabel, OUTPUT_SENSOR_CODE } = require('../../shared/sensorIdentity')
const {
  attributeMachineDowntime,
  calculateMachineMetrics,
  toMinutes,
} = require('../../shared/operationalMetrics')
const { getOverlappingDowntime } = require('../downtime/downtime.repository')
const { getSettingsHistory } = require('../settings/settingsHistory.repository')
const { aggregateSensorEvents } = require('../../shared/sensorEventAggregation.repository')

const PROCESS_SENSOR_CODES = ['S-01', 'S-02', 'S-04']

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

async function getEventSummary(machineId, window) {
  const bucketSeconds = Math.floor((window.end.getTime() - window.start.getTime()) / 1000)
  const rows = await aggregateSensorEvents(machineId, window, bucketSeconds)
  const totals = rows.reduce((result, row) => {
    result[row.sensor_code] = (result[row.sensor_code] || 0) + Number(row.event_count || 0)
    return result
  }, {})

  return {
    productionTotal: totals[OUTPUT_SENSOR_CODE] || 0,
    processSensors: PROCESS_SENSOR_CODES.map((sensorCode) => ({
      sensorCode,
      sensorLabel: getSensorLabel(sensorCode),
      eventCount: totals[sensorCode] || 0,
    })),
  }
}

async function getSummary({ type = 'daily', date } = {}) {
  const asOf = new Date()
  const machine = await getMachine()
  const window = getWindow(type, date)
  const [eventSummary, downtimeRows, settingsHistory] = await Promise.all([
    getEventSummary(machine.id, window),
    getOverlappingDowntime(machine.id, window),
    getSettingsHistory(machine.id, window),
  ])
  const metrics = calculateMachineMetrics({ records: downtimeRows, window, settingsHistory, asOf })
  const rows = attributeMachineDowntime({ records: downtimeRows, window, settingsHistory, asOf })
  const availabilityValue = metrics.availabilityPercent === null ? 'N/A' : `${metrics.availabilityPercent}%`
  const processEventTotal = eventSummary.processSensors.reduce((sum, sensor) => sum + sensor.eventCount, 0)

  return {
    reportType: type,
    selectedDate: date || formatBusinessDate(),
    summary: [
      { id: 'production', label: 'Production Count', value: `${formatNumber(eventSummary.productionTotal)} pcs`, helper: `From ${machine.name}` },
      { id: 'process-events', label: 'Process Events', value: formatNumber(processEventTotal), helper: 'From S-01, S-02, and S-04 pulses' },
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
    processSensors: eventSummary.processSensors,
    rows,
  }
}

module.exports = {
  getSummary,
}
