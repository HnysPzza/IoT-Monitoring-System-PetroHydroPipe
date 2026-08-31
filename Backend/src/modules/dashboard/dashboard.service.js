const { getSupabaseClient } = require('../../database/client')
const {
  addBusinessDays,
  addBusinessMonths,
  formatBusinessTime,
  formatBusinessWeekday,
  parseBusinessDate,
  startOfBusinessDay,
  startOfBusinessMonth,
  startOfBusinessWeek,
} = require('../../shared/businessTime')
const { getSensorLabel, OUTPUT_SENSOR_CODE } = require('../../shared/sensorIdentity')
const {
  attributeMachineDowntime,
  calculateMachineMetrics,
} = require('../../shared/operationalMetrics')
const { getOverlappingDowntime } = require('../downtime/downtime.repository')
const { getSettingsHistory } = require('../settings/settingsHistory.repository')
const { aggregateSensorEvents } = require('../../shared/sensorEventAggregation.repository')

const DOWNTIME_THRESHOLD_MINUTES = 30

function createDashboardError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function parseAnchorDate(value) {
  return parseBusinessDate(value)
}

function getWindowForMode(mode, anchorDate) {
  if (mode === 'month') {
    const start = startOfBusinessMonth(anchorDate)
    return { start, end: addBusinessMonths(start, 1) }
  }

  if (mode === 'week') {
    const start = startOfBusinessWeek(anchorDate)
    return { start, end: addBusinessDays(start, 7) }
  }

  const start = startOfBusinessDay(anchorDate)
  return { start, end: addBusinessDays(start, 1) }
}

function getPreviousDayWindow(window) {
  return { start: addBusinessDays(window.start, -1), end: window.start }
}

function minutesBetween(start, end) {
  const endedAt = end ? new Date(end) : new Date()
  return Math.max(0, Math.round((endedAt.getTime() - new Date(start).getTime()) / 60000))
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-PH')
}

async function getMachineAndSensors() {
  const supabase = getSupabaseClient()
  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('id, machine_code, name, status, location, updated_at')
    .eq('machine_code', 'M-01')
    .maybeSingle()

  if (machineError) {
    throw createDashboardError(500, 'OVERVIEW_MACHINE_QUERY_FAILED', 'Unable to load overview machine.')
  }

  if (!machine) {
    throw createDashboardError(404, 'MACHINE_NOT_FOUND', 'Spiral Mill 01 was not found.')
  }

  const { data: sensors, error: sensorsError } = await supabase
    .from('sensors')
    .select('id, sensor_code, status, label, updated_at')
    .eq('machine_id', machine.id)
    .order('sensor_code', { ascending: true })

  if (sensorsError) {
    throw createDashboardError(500, 'OVERVIEW_SENSORS_QUERY_FAILED', 'Unable to load overview sensors.')
  }

  return { machine, sensors: sensors || [] }
}

async function getProductionEvents(machineId, range) {
  const rows = await aggregateSensorEvents(machineId, range, 3600)
  return rows.filter((row) => row.sensor_code === OUTPUT_SENSOR_CODE)
}

function getProductionTotal(events, window) {
  const startTime = window.start.getTime()
  const endTime = window.end.getTime()

  return events.reduce((count, row) => {
    const rowTime = new Date(row.bucket_start).getTime()
    return rowTime >= startTime && rowTime < endTime ? count + Number(row.event_count || 0) : count
  }, 0)
}

function getModePointBoundaries(mode, window, asOf) {
  const withPeriodState = (boundary) => {
    const periodState = asOf <= boundary.start
      ? 'future'
      : asOf < boundary.end
        ? 'current'
        : 'completed'

    return {
      ...boundary,
      end: periodState === 'current' ? new Date(asOf) : boundary.end,
      periodState,
    }
  }

  if (mode === 'month') {
    return Array.from({ length: 4 }, (_, index) => {
      const start = addBusinessDays(window.start, index * 7)
      const end = index === 3 ? window.end : addBusinessDays(window.start, (index + 1) * 7)
      return { label: `W${index + 1}`, shift: `Week ${index + 1}`, start, end }
    }).map(withPeriodState)
  }

  if (mode === 'week') {
    return Array.from({ length: 7 }, (_, index) => {
      const start = addBusinessDays(window.start, index)
      return {
        label: formatBusinessWeekday(start),
        shift: `Day ${index + 1}`,
        start,
        end: addBusinessDays(start, 1),
      }
    }).map(withPeriodState)
  }

  return [6, 9, 12, 15, 18, 21].map((hour) => {
    const start = new Date(window.start.getTime() + (hour * 60 * 60 * 1000))
    return {
      label: formatBusinessTime(start, { hour: 'numeric', hour12: true }).replace(' ', ''),
      shift: hour < 15 ? 'Shift A' : 'Shift B',
      start: window.start,
      end: start,
    }
  }).map(withPeriodState)
}

function getDailyDowntimeBoundaries(window, asOf) {
  const periods = [
    { label: '12-6AM', startHour: 0, endHour: 6 },
    { label: '6-9AM', startHour: 6, endHour: 9 },
    { label: '9AM-12PM', startHour: 9, endHour: 12 },
    { label: '12-3PM', startHour: 12, endHour: 15 },
    { label: '3-6PM', startHour: 15, endHour: 18 },
    { label: '6-9PM', startHour: 18, endHour: 21 },
  ]

  return periods.map((period) => {
    const start = new Date(window.start.getTime() + (period.startHour * 60 * 60 * 1000))
    const end = new Date(window.start.getTime() + (period.endHour * 60 * 60 * 1000))
    const periodState = asOf <= start
      ? 'future'
      : asOf < end
        ? 'current'
        : 'completed'

    return {
      label: period.label,
      start,
      end: periodState === 'current' ? new Date(asOf) : end,
      periodState,
    }
  })
}

function getDailyProductionBoundaries(window, previousWindow, asOf) {
  return [6, 9, 12, 15, 18, 21].map((hour, index, hours) => {
    const segmentStart = new Date(window.start.getTime() + ((hours[index - 1] || 0) * 60 * 60 * 1000))
    const checkpointEnd = new Date(window.start.getTime() + (hour * 60 * 60 * 1000))
    const periodState = asOf <= segmentStart
      ? 'future'
      : asOf < checkpointEnd
        ? 'current'
        : 'completed'
    const currentEnd = periodState === 'current' ? new Date(asOf) : checkpointEnd

    return {
      label: formatBusinessTime(checkpointEnd, { hour: 'numeric', hour12: true }).replace(' ', ''),
      shift: hour < 15 ? 'Shift A' : 'Shift B',
      periodState,
      currentEnd,
      previousEnd: new Date(previousWindow.start.getTime() + (currentEnd.getTime() - window.start.getTime())),
    }
  })
}

async function buildProductionAnalytics(machineId, anchorDate, asOf) {
  const window = getWindowForMode('today', anchorDate)
  const previousWindow = getPreviousDayWindow(window)
  const observedEnd = new Date(Math.min(Math.max(asOf.getTime(), window.start.getTime()), window.end.getTime()))
  const previousObservedEnd = new Date(previousWindow.start.getTime() + (observedEnd.getTime() - window.start.getTime()))
  const boundaries = getDailyProductionBoundaries(window, previousWindow, observedEnd)
  const events = await getProductionEvents(machineId, {
    start: previousWindow.start,
    end: observedEnd,
  })
  const currentTotal = getProductionTotal(events, { start: window.start, end: observedEnd })
  const previousTotal = getProductionTotal(events, { start: previousWindow.start, end: previousObservedEnd })
  const difference = currentTotal - previousTotal
  const differencePercent = previousTotal > 0
    ? Number(((difference / previousTotal) * 100).toFixed(2))
    : null
  const points = boundaries.map((boundary) => ({
    label: boundary.label,
    shift: boundary.shift,
    periodState: boundary.periodState,
    current: boundary.periodState === 'future'
      ? null
      : getProductionTotal(events, { start: window.start, end: boundary.currentEnd }),
    previous: boundary.periodState === 'future'
      ? null
      : getProductionTotal(events, { start: previousWindow.start, end: boundary.previousEnd }),
  }))

  return {
    day: {
      label: 'Today so far vs Yesterday at same time',
      currentLabel: 'Today so far',
      previousLabel: 'Yesterday at same time',
      currentTotal,
      previousTotal,
      difference,
      differencePercent,
      unit: 'pcs',
      points,
    },
  }
}

function buildDowntimeImpact(rows, mode, anchorDate, settingsHistory, asOf) {
  const window = getWindowForMode(mode, anchorDate)
  const boundaries = mode === 'today'
    ? getDailyDowntimeBoundaries(window, asOf)
    : getModePointBoundaries(mode, window, asOf)

  return {
    thresholdMinutes: DOWNTIME_THRESHOLD_MINUTES,
    points: boundaries.map((boundary) => {
      if (boundary.periodState === 'future') {
        return {
          label: boundary.label,
          periodState: 'future',
          minutes: null,
          unplannedMinutes: null,
          plannedExcludedMinutes: null,
          estimatedLoss: null,
          cause: null,
        }
      }

      const metrics = calculateMachineMetrics({
        records: rows,
        window: boundary,
        settingsHistory,
        asOf,
      })
      const reviewedRows = rows.filter((row) => row.cause && row.cause !== 'Pending Cause Review')
      const pendingReviewRows = rows.filter((row) => !row.cause || row.cause === 'Pending Cause Review')
      const attributed = attributeMachineDowntime({
        records: reviewedRows,
        window: boundary,
        settingsHistory,
        asOf,
      })
      const pendingReview = attributeMachineDowntime({
        records: pendingReviewRows,
        window: boundary,
        settingsHistory,
        asOf,
      })

      return {
        label: boundary.label,
        ...(boundary.periodState ? { periodState: boundary.periodState } : {}),
        minutes: metrics.durationMinutes,
        unplannedMinutes: metrics.unplannedMinutes,
        plannedExcludedMinutes: metrics.plannedExcludedMinutes,
        estimatedLoss: metrics.estimatedLoss,
        cause: attributed[0]?.cause || null,
        causeReviewPending: pendingReview.length > 0,
      }
    }),
  }
}

function buildAlerts(machine, sensors, downtimeRows) {
  const openDowntime = downtimeRows.filter((row) => row.status === 'Open')
  const faultSensors = sensors.filter((sensor) => sensor.status === 'Fault')
  const alerts = []

  openDowntime.slice(0, 2).forEach((row) => {
    alerts.push({
      id: row.id,
      type: 'danger',
      message: `${machine.name} downtime is open. Duration: ${minutesBetween(row.started_at, row.ended_at)} min. Cause: ${row.cause || 'pending review'}.`,
    })
  })

  faultSensors.slice(0, 2).forEach((sensor) => {
    alerts.push({
      id: sensor.id,
      type: 'danger',
      message: `${sensor.sensor_code} ${getSensorLabel(sensor.sensor_code, sensor.label)} is reporting a fault.`,
    })
  })

  return alerts
}

async function getOverview(filters = {}) {
  const asOf = new Date()
  const mode = filters.trendMode || 'week'
  const anchorDate = parseAnchorDate(filters.date)
  const { machine, sensors } = await getMachineAndSensors()
  const todayWindow = getWindowForMode('today', startOfBusinessDay())
  const trendWindow = getWindowForMode(mode, anchorDate)
  const [todayDowntimeRows, trendDowntimeRows, todaySettingsHistory, trendSettingsHistory, productionAnalytics] = await Promise.all([
    getOverlappingDowntime(machine.id, todayWindow),
    getOverlappingDowntime(machine.id, trendWindow),
    getSettingsHistory(machine.id, todayWindow),
    getSettingsHistory(machine.id, trendWindow),
    buildProductionAnalytics(machine.id, todayWindow.start, asOf),
  ])

  const productionToday = productionAnalytics.day.currentTotal
  const observedTodayWindow = {
    start: todayWindow.start,
    end: new Date(Math.min(todayWindow.end.getTime(), asOf.getTime())),
  }
  const todayMetrics = calculateMachineMetrics({
    records: todayDowntimeRows,
    window: observedTodayWindow,
    settingsHistory: todaySettingsHistory,
    asOf,
  })
  const openDowntimeCount = todayDowntimeRows.filter((row) => row.status === 'Open').length
  const availabilityValue = todayMetrics.availabilityPercent === null
    ? 'N/A'
    : `${todayMetrics.availabilityPercent}%`

  return {
    alerts: buildAlerts(machine, sensors, todayDowntimeRows),
    summary: [
      { id: 'pipes', label: 'Production Output Today', value: `${formatNumber(productionToday)} pcs`, tone: 'success', helper: 'From S-05 output cutting events' },
      { id: 'events', label: 'Downtime Events', value: String(todayDowntimeRows.length), tone: 'warning', helper: `${openDowntimeCount} unresolved today` },
      { id: 'minutes', label: 'Downtime Today', value: `${todayMetrics.durationMinutes} min`, tone: 'danger', helper: `${todayMetrics.unplannedMinutes} unplanned min` },
      { id: 'availability', label: 'Machine Availability', value: availabilityValue, tone: 'primary', helper: `For ${machine.name}` },
    ],
    productionAnalytics,
    downtimeImpact: buildDowntimeImpact(trendDowntimeRows, mode, anchorDate, trendSettingsHistory, asOf),
    unreadAlerts: buildAlerts(machine, sensors, todayDowntimeRows).length,
  }
}

async function getDowntimeImpact(filters = {}) {
  const asOf = new Date()
  const mode = filters.trendMode || 'week'
  const anchorDate = parseAnchorDate(filters.date)
  const { machine } = await getMachineAndSensors()
  const trendWindow = getWindowForMode(mode, anchorDate)
  const [trendDowntimeRows, settingsHistory] = await Promise.all([
    getOverlappingDowntime(machine.id, trendWindow),
    getSettingsHistory(machine.id, trendWindow),
  ])

  return buildDowntimeImpact(trendDowntimeRows, mode, anchorDate, settingsHistory, asOf)
}

module.exports = {
  getDowntimeImpact,
  getOverview,
}
