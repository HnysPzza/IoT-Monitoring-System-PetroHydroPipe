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
const { getSensorLabel } = require('../../shared/sensorIdentity')

const OUTPUT_SENSOR_CODE = 'S-05'
const OUTPUT_TARGETS = {
  day: 1400,
  week: 7600,
  month: 30000,
}
const DOWNTIME_THRESHOLD_MINUTES = 30
const LOSS_PER_DOWNTIME_MINUTE = 2.3

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

function getPreviousWindow(mode, window) {
  if (mode === 'month') {
    const start = addBusinessMonths(window.start, -1)
    return { start, end: window.start }
  }

  if (mode === 'week') {
    return { start: addBusinessDays(window.start, -7), end: window.start }
  }

  return { start: addBusinessDays(window.start, -1), end: window.start }
}

function minutesBetween(start, end) {
  const endedAt = end ? new Date(end) : new Date()
  return Math.max(0, Math.round((endedAt.getTime() - new Date(start).getTime()) / 60000))
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-PH')
}

function formatSensorName(sensorCode) {
  return `${sensorCode} ${getSensorLabel(sensorCode)}`
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

async function getProductionSource(machineId, range) {
  const supabase = getSupabaseClient()
  const { data: counts, error: countsError } = await supabase
    .from('production_counts')
    .select('count_value, window_start')
    .eq('machine_id', machineId)
    .gte('window_start', range.start.toISOString())
    .lt('window_start', range.end.toISOString())

  if (countsError) {
    throw createDashboardError(500, 'PRODUCTION_COUNT_QUERY_FAILED', 'Unable to load production counts.')
  }

  const { data: outputSensor, error: sensorError } = await supabase
    .from('sensors')
    .select('id')
    .eq('machine_id', machineId)
    .eq('sensor_code', OUTPUT_SENSOR_CODE)
    .maybeSingle()

  if (sensorError) {
    throw createDashboardError(500, 'OUTPUT_SENSOR_QUERY_FAILED', 'Unable to load production output sensor.')
  }

  if (!outputSensor) {
    return { counts: counts || [], events: [] }
  }

  const { data: events, error: eventError } = await supabase
    .from('sensor_events')
    .select('recorded_at')
    .eq('machine_id', machineId)
    .eq('sensor_id', outputSensor.id)
    .eq('event_type', 'pulse')
    .gte('recorded_at', range.start.toISOString())
    .lt('recorded_at', range.end.toISOString())

  if (eventError) {
    throw createDashboardError(500, 'PRODUCTION_EVENT_QUERY_FAILED', 'Unable to load production event count.')
  }

  return { counts: counts || [], events: events || [] }
}

function getProductionTotalFromSource(source, window) {
  const startTime = window.start.getTime()
  const endTime = window.end.getTime()
  const summarizedCount = source.counts.reduce((sum, row) => {
    const rowTime = new Date(row.window_start).getTime()
    return rowTime >= startTime && rowTime < endTime ? sum + Number(row.count_value || 0) : sum
  }, 0)

  if (summarizedCount > 0) {
    return summarizedCount
  }

  return source.events.reduce((count, row) => {
    const rowTime = new Date(row.recorded_at).getTime()
    return rowTime >= startTime && rowTime < endTime ? count + 1 : count
  }, 0)
}

async function getDowntimeRows(machineId, window) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('downtime_events')
    .select('id, started_at, ended_at, duration_seconds, cause, status, sensor_id, sensors(sensor_code, label)')
    .eq('machine_id', machineId)
    .gte('started_at', window.start.toISOString())
    .lt('started_at', window.end.toISOString())
    .order('started_at', { ascending: true })

  if (error) {
    throw createDashboardError(500, 'OVERVIEW_DOWNTIME_QUERY_FAILED', 'Unable to load overview downtime.')
  }

  return data || []
}

function getDowntimeMinutes(rows) {
  return rows.reduce((sum, row) => {
    const minutes = row.duration_seconds != null ? Math.round(row.duration_seconds / 60) : minutesBetween(row.started_at, row.ended_at)
    return sum + minutes
  }, 0)
}

function getModePointBoundaries(mode, window) {
  if (mode === 'month') {
    return Array.from({ length: 4 }, (_, index) => {
      const start = addBusinessDays(window.start, index * 7)
      const end = index === 3 ? window.end : addBusinessDays(window.start, (index + 1) * 7)
      return { label: `W${index + 1}`, shift: `Week ${index + 1}`, start, end }
    })
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
    })
  }

  return [6, 9, 12, 15, 18, 21].map((hour) => {
    const start = new Date(window.start.getTime() + (hour * 60 * 60 * 1000))
    return {
      label: formatBusinessTime(start, { hour: 'numeric', hour12: true }).replace(' ', ''),
      shift: hour < 15 ? 'Shift A' : 'Shift B',
      start: window.start,
      end: start,
    }
  })
}

async function buildProductionAnalytics(machineId, anchorDate) {
  const modes = ['day', 'week', 'month']
  const labels = {
    day: ['Daily Output', 'Today', 'Yesterday'],
    week: ['Weekly Output', 'This Week', 'Last Week'],
    month: ['Monthly Output', 'This Month', 'Last Month'],
  }
  const analytics = {}
  const configs = modes.map((mode) => {
    const window = getWindowForMode(mode === 'day' ? 'today' : mode, anchorDate)
    const previousWindow = getPreviousWindow(mode === 'day' ? 'today' : mode, window)
    const boundaries = getModePointBoundaries(mode, window)
    const previousBoundaries = getModePointBoundaries(mode, previousWindow)

    return { mode, window, previousWindow, boundaries, previousBoundaries }
  })
  const sourceRange = configs.reduce((range, config) => ({
    start: config.previousWindow.start < range.start ? config.previousWindow.start : range.start,
    end: config.window.end > range.end ? config.window.end : range.end,
  }), { start: configs[0].previousWindow.start, end: configs[0].window.end })
  const productionSource = await getProductionSource(machineId, sourceRange)

  for (const config of configs) {
    const { mode, window, previousWindow, boundaries, previousBoundaries } = config
    const currentTotal = getProductionTotalFromSource(productionSource, window)
    const previousTotal = getProductionTotalFromSource(productionSource, previousWindow)
    const targetTotal = OUTPUT_TARGETS[mode]

    const points = []
    for (let index = 0; index < boundaries.length; index += 1) {
      const currentBoundary = { start: window.start, end: boundaries[index].end }
      const previousBoundary = { start: previousWindow.start, end: previousBoundaries[index]?.end || previousWindow.end }
      const current = getProductionTotalFromSource(productionSource, currentBoundary)
      const previous = getProductionTotalFromSource(productionSource, previousBoundary)
      const target = Math.round((targetTotal / boundaries.length) * (index + 1))

      points.push({
        label: boundaries[index].label,
        shift: boundaries[index].shift,
        current,
        previous,
        target,
        estimatedLoss: 0,
      })
    }

    analytics[mode] = {
      label: labels[mode][0],
      currentLabel: labels[mode][1],
      previousLabel: labels[mode][2],
      currentTotal,
      previousTotal,
      targetTotal,
      unit: 'pcs',
      points,
    }
  }

  return analytics
}

function buildDowntimeImpact(rows, mode, anchorDate) {
  const window = getWindowForMode(mode, anchorDate)
  const boundaries = getModePointBoundaries(mode === 'today' ? 'day' : mode, window)

  return {
    thresholdMinutes: DOWNTIME_THRESHOLD_MINUTES,
    points: boundaries.map((boundary) => {
      const matchingRows = rows.filter((row) => {
        const startedAt = new Date(row.started_at)
        return startedAt >= boundary.start && startedAt < boundary.end
      })
      const minutes = getDowntimeMinutes(matchingRows)
      const primaryCause = matchingRows[0]?.cause || 'No downtime recorded'

      return {
        label: boundary.label,
        minutes,
        estimatedLoss: Math.round(minutes * LOSS_PER_DOWNTIME_MINUTE),
        cause: primaryCause,
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

function buildAvailability(machine, sensors, downtimeMinutes) {
  const machineAvailability = Math.max(0, Math.round(100 - (downtimeMinutes / 1440) * 100))

  return [
    { machineId: machine.name, percent: machineAvailability },
    ...sensors.map((sensor) => ({
      machineId: formatSensorName(sensor.sensor_code),
      percent: sensor.status === 'Fault' ? 75 : sensor.status === 'Inactive' ? 90 : 98,
    })),
  ]
}

async function getOverview(filters = {}) {
  const mode = filters.trendMode || 'week'
  const anchorDate = parseAnchorDate(filters.date)
  const { machine, sensors } = await getMachineAndSensors()
  const todayWindow = getWindowForMode('today', startOfBusinessDay())
  const trendWindow = getWindowForMode(mode, anchorDate)
  const [todayDowntimeRows, trendDowntimeRows, productionAnalytics] = await Promise.all([
    getDowntimeRows(machine.id, todayWindow),
    getDowntimeRows(machine.id, trendWindow),
    buildProductionAnalytics(machine.id, anchorDate),
  ])

  const productionToday = productionAnalytics.day.currentTotal
  const downtimeTodayMinutes = getDowntimeMinutes(todayDowntimeRows)
  const openDowntimeCount = todayDowntimeRows.filter((row) => row.status === 'Open').length
  const availability = buildAvailability(machine, sensors, downtimeTodayMinutes)
  const machineAvailability = availability[0]?.percent || 100

  return {
    alerts: buildAlerts(machine, sensors, todayDowntimeRows),
    summary: [
      { id: 'pipes', label: 'Total Pipes Today', value: `${formatNumber(productionToday)} pcs`, tone: 'success', helper: 'From S-05 output cutting events' },
      { id: 'events', label: 'Downtime Events', value: String(todayDowntimeRows.length), tone: 'warning', helper: `${openDowntimeCount} unresolved today` },
      { id: 'minutes', label: 'Downtime Today', value: `${downtimeTodayMinutes} min`, tone: 'danger', helper: 'From downtime records' },
      { id: 'availability', label: 'Machine Availability', value: `${machineAvailability}%`, tone: 'primary', helper: `For ${machine.name}` },
    ],
    productionAnalytics,
    downtimeImpact: buildDowntimeImpact(trendDowntimeRows, mode, anchorDate),
    availability,
    unreadAlerts: buildAlerts(machine, sensors, todayDowntimeRows).length,
  }
}

async function getDowntimeImpact(filters = {}) {
  const mode = filters.trendMode || 'week'
  const anchorDate = parseAnchorDate(filters.date)
  const { machine } = await getMachineAndSensors()
  const trendWindow = getWindowForMode(mode, anchorDate)
  const trendDowntimeRows = await getDowntimeRows(machine.id, trendWindow)

  return buildDowntimeImpact(trendDowntimeRows, mode, anchorDate)
}

module.exports = {
  getDowntimeImpact,
  getOverview,
}
