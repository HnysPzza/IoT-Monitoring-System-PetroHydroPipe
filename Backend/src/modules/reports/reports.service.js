const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
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
const { getOutputLossBasis } = require('../../shared/outputLossBasis')
const reportsRepository = require('./reports.repository')

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

function getObservedWindow(window, asOf) {
  if (asOf <= window.start) return { periodState: 'future', window: null }
  if (asOf < window.end) {
    return { periodState: 'partial', window: { start: window.start, end: asOf } }
  }
  return { periodState: 'complete', window }
}

function getPreviousWindow(type, window) {
  if (type === 'monthly') {
    return { start: addBusinessMonths(window.start, -1), end: window.start }
  }

  const days = type === 'weekly' ? 7 : 1
  return { start: addBusinessDays(window.start, -days), end: window.start }
}

function getComparisonWindow(type, currentWindow, periodState, asOf) {
  const previousWindow = getPreviousWindow(type, currentWindow)
  const elapsedMilliseconds = periodState === 'partial'
    ? asOf.getTime() - currentWindow.start.getTime()
    : previousWindow.end.getTime() - previousWindow.start.getTime()
  const end = new Date(Math.min(
    previousWindow.end.getTime(),
    previousWindow.start.getTime() + elapsedMilliseconds,
  ))

  return { start: previousWindow.start, end }
}

function getUnobservedReport(type, date, asOf) {
  return {
    category: 'regular',
    generatedAt: asOf.toISOString(),
    reportType: type,
    selectedDate: date,
    periodState: 'future',
    observedStartAt: null,
    observedEndAt: null,
    summary: [
      { id: 'production', label: 'Production Count', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'process-events', label: 'Process Events', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'events', label: 'Downtime Events', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'duration', label: 'Downtime Duration', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'availability', label: 'Availability', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'loss', label: 'Estimated Loss', value: 'N/A', helper: 'Period not reached yet' },
    ],
    metrics: {
      outputPieces: null,
      durationMinutes: null,
      unplannedMinutes: null,
      plannedExcludedMinutes: null,
      scheduledEligibleMinutes: null,
      availabilityPercent: null,
      estimatedLoss: null,
    },
    processSensors: PROCESS_SENSOR_CODES.map((sensorCode) => ({
      sensorCode,
      sensorLabel: getSensorLabel(sensorCode),
      eventCount: null,
    })),
    rows: [],
  }
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
  const bucketSeconds = Math.max(3600, Math.floor((window.end.getTime() - window.start.getTime()) / 1000))
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

async function buildObservedReport({ type, selectedDate, machine, window, periodState, asOf, lossEstimateBasis }) {
  const [eventSummary, downtimeRows, settingsHistory] = await Promise.all([
    getEventSummary(machine.id, window),
    getOverlappingDowntime(machine.id, window),
    getSettingsHistory(machine.id, window),
  ])
  const lossRatePiecesPerMinute = lossEstimateBasis.ratePiecesPerMinute
  const metrics = calculateMachineMetrics({
    records: downtimeRows,
    window,
    settingsHistory,
    asOf,
    lossRatePiecesPerMinute,
  })
  const rows = attributeMachineDowntime({
    records: downtimeRows,
    window,
    settingsHistory,
    asOf,
    lossRatePiecesPerMinute,
  })
  const availabilityValue = metrics.availabilityPercent === null ? 'N/A' : `${metrics.availabilityPercent}%`
  const processEventTotal = eventSummary.processSensors.reduce((sum, sensor) => sum + sensor.eventCount, 0)

  return {
    category: 'regular',
    generatedAt: asOf.toISOString(),
    reportType: type,
    selectedDate,
    periodState,
    observedStartAt: window.start.toISOString(),
    observedEndAt: window.end.toISOString(),
    lossEstimateBasis,
    summary: [
      { id: 'production', label: 'Production Count', value: `${formatNumber(eventSummary.productionTotal)} pcs`, helper: `From ${machine.name}` },
      { id: 'process-events', label: 'Process Events', value: formatNumber(processEventTotal), helper: 'From S-01, S-02, and S-04 pulses' },
      { id: 'events', label: 'Downtime Events', value: String(downtimeRows.length), helper: 'Open and resolved events' },
      { id: 'duration', label: 'Downtime Duration', value: `${metrics.durationMinutes} min`, helper: `${metrics.unplannedMinutes} unplanned min` },
      { id: 'availability', label: 'Availability', value: availabilityValue, helper: 'Based on eligible production time' },
      { id: 'loss', label: 'Estimated Loss', value: `${metrics.estimatedLoss} pcs`, helper: `Using ${Math.ceil(lossRatePiecesPerMinute * 60)} pcs/hr` },
    ],
    metrics: {
      outputPieces: eventSummary.productionTotal,
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

function checkIsSpecified(spec) {
  if (!spec) return false
  const hasLabel = spec.label != null && String(spec.label).trim() !== ''
  const hasSize = spec.size != null && String(spec.size).trim() !== ''
  const hasValidDimension = (val) => val != null && !isNaN(Number(val)) && Number(val) > 0
  return (
    hasLabel ||
    hasSize ||
    hasValidDimension(spec.diameter) ||
    hasValidDimension(spec.radius) ||
    hasValidDimension(spec.circumference)
  )
}

function getUnobservedProductionReport(type, date, asOf) {
  return {
    category: 'production',
    generatedAt: asOf.toISOString(),
    reportType: type,
    selectedDate: date,
    periodState: 'future',
    observedStartAt: null,
    observedEndAt: null,
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'specified-pipes', label: 'Specified Pipes', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: 'N/A', helper: 'Period not reached yet' },
    ],
    metrics: {
      totalProductionOutput: null,
      specifiedPipes: null,
      unspecifiedPipes: null,
      distinctProductSizes: null,
    },
    totalProductionOutput: null,
    specifiedPipes: null,
    unspecifiedPipes: null,
    distinctProductSizes: null,
    specBreakdown: [],
    productionLogs: [],
    rows: [],
  }
}

async function buildObservedProductionReport({
  type,
  selectedDate,
  machine,
  sensor,
  sensorLabel,
  window,
  periodState,
  asOf,
  suppliedClient,
}) {
  const eventsWithSpecs = await reportsRepository.findAcceptedCuttingEventsWithSpecs(
    {
      sensorId: sensor.id,
      startIso: window.start.toISOString(),
      endIso: window.end.toISOString(),
    },
    suppliedClient,
  )

  const sortedEvents = [...eventsWithSpecs].sort((a, b) => {
    const timeDiff = new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    if (timeDiff !== 0) return timeDiff
    return String(a.id || '').localeCompare(String(b.id || ''))
  })

  const groupsMap = new Map()
  const distinctSizes = new Set()
  let unspecifiedGroup = null
  let specifiedPipes = 0
  let unspecifiedPipes = 0

  const productionLogs = sortedEvents.map((event) => {
    const spec = event.spec
    const isSpecified = checkIsSpecified(spec)

    const label = spec?.label != null && String(spec.label).trim() !== '' ? String(spec.label).trim() : null
    const size = spec?.size != null && String(spec.size).trim() !== '' ? String(spec.size).trim() : null
    const diameter = spec?.diameter != null && !isNaN(Number(spec.diameter)) ? Number(spec.diameter) : null
    const radius = spec?.radius != null && !isNaN(Number(spec.radius)) ? Number(spec.radius) : null
    const circumference = spec?.circumference != null && !isNaN(Number(spec.circumference)) ? Number(spec.circumference) : null

    if (isSpecified) {
      specifiedPipes += 1
      const groupKey = JSON.stringify([label, size, diameter, radius, circumference])
      const existing = groupsMap.get(groupKey)

      if (existing) {
        existing.pipeCount += 1
        if (new Date(event.recorded_at) < new Date(existing.firstCutAt)) {
          existing.firstCutAt = event.recorded_at
        }
        if (new Date(event.recorded_at) > new Date(existing.lastCutAt)) {
          existing.lastCutAt = event.recorded_at
        }
      } else {
        groupsMap.set(groupKey, {
          label,
          size,
          diameter,
          radius,
          circumference,
          isSpecified: true,
          pipeCount: 1,
          firstCutAt: event.recorded_at,
          lastCutAt: event.recorded_at,
        })
      }

      const distinctSizeKey = (label || size)
        ? JSON.stringify([label, size])
        : JSON.stringify([diameter, radius, circumference])
      distinctSizes.add(distinctSizeKey)
    } else {
      unspecifiedPipes += 1
      if (unspecifiedGroup) {
        unspecifiedGroup.pipeCount += 1
        if (new Date(event.recorded_at) < new Date(unspecifiedGroup.firstCutAt)) {
          unspecifiedGroup.firstCutAt = event.recorded_at
        }
        if (new Date(event.recorded_at) > new Date(unspecifiedGroup.lastCutAt)) {
          unspecifiedGroup.lastCutAt = event.recorded_at
        }
      } else {
        unspecifiedGroup = {
          label: 'Unspecified / Pending Tag',
          size: null,
          diameter: null,
          radius: null,
          circumference: null,
          isSpecified: false,
          pipeCount: 1,
          firstCutAt: event.recorded_at,
          lastCutAt: event.recorded_at,
        }
      }
    }

    return {
      id: event.id,
      sensorEventId: event.id,
      deviceEventId: event.device_event_id || null,
      recordedAt: event.recorded_at,
      label,
      size,
      diameter,
      radius,
      circumference,
      isSpecified,
      updatedBy: spec?.updated_by ?? null,
    }
  })

  const totalProductionOutput = sortedEvents.length

  const specBreakdown = Array.from(groupsMap.values())
    .map((group) => ({
      ...group,
      percentageOfTotal: totalProductionOutput > 0
        ? Number(((group.pipeCount / totalProductionOutput) * 100).toFixed(1))
        : 0,
    }))
    .sort((a, b) => {
      if (b.pipeCount !== a.pipeCount) return b.pipeCount - a.pipeCount
      const labelComp = String(a.label || '').localeCompare(String(b.label || ''))
      if (labelComp !== 0) return labelComp
      const sizeComp = String(a.size || '').localeCompare(String(b.size || ''))
      if (sizeComp !== 0) return sizeComp
      return (a.diameter ?? 0) - (b.diameter ?? 0)
    })

  if (unspecifiedGroup) {
    unspecifiedGroup.percentageOfTotal = totalProductionOutput > 0
      ? Number(((unspecifiedGroup.pipeCount / totalProductionOutput) * 100).toFixed(1))
      : 0
    specBreakdown.push(unspecifiedGroup)
  }

  const metrics = {
    totalProductionOutput,
    specifiedPipes,
    unspecifiedPipes,
    distinctProductSizes: distinctSizes.size,
  }

  const summary = [
    {
      id: 'total-output',
      label: 'Total Production Output',
      value: `${formatNumber(totalProductionOutput)} pcs`,
      helper: `From ${machine?.name || 'Spiral Mill 01'}`,
    },
    {
      id: 'specified-pipes',
      label: 'Specified Pipes',
      value: `${formatNumber(specifiedPipes)} pcs`,
      helper: `${totalProductionOutput > 0 ? Math.round((specifiedPipes / totalProductionOutput) * 100) : 0}% of total output`,
    },
    {
      id: 'unspecified-pipes',
      label: 'Unspecified Pipes',
      value: `${formatNumber(unspecifiedPipes)} pcs`,
      helper: 'Pending specification tag',
    },
    {
      id: 'distinct-sizes',
      label: 'Distinct Product Sizes',
      value: String(distinctSizes.size),
      helper: 'Unique pipe specs produced',
    },
  ]

  return {
    category: 'production',
    generatedAt: asOf.toISOString(),
    reportType: type,
    selectedDate,
    periodState,
    observedStartAt: window.start.toISOString(),
    observedEndAt: window.end.toISOString(),
    machine: {
      id: machine?.id || null,
      code: machine?.machine_code || machine?.code || 'M-01',
      name: machine?.name || 'Spiral Mill 01',
    },
    sensor: {
      id: sensor?.id || null,
      code: sensor?.sensor_code || OUTPUT_SENSOR_CODE,
      label: sensorLabel,
    },
    summary,
    metrics,
    totalProductionOutput,
    specifiedPipes,
    unspecifiedPipes,
    distinctProductSizes: distinctSizes.size,
    specBreakdown,
    productionLogs,
    rows: productionLogs,
  }
}

async function getProductionSummary({ type = 'daily', date, compare = false } = {}, options = {}) {
  const asOf = options.asOf || new Date()
  const selectedDate = date || formatBusinessDate(asOf)
  const requestedWindow = getWindow(type, selectedDate)
  const observed = getObservedWindow(requestedWindow, asOf)

  if (!observed.window) {
    return compare
      ? { ...getUnobservedProductionReport(type, selectedDate, asOf), comparison: null }
      : getUnobservedProductionReport(type, selectedDate, asOf)
  }

  const sensorConfig = await reportsRepository.findOutputSensor(options.client)
  if (!sensorConfig?.id) {
    throw createReportError(500, 'REPORT_PRODUCTION_SENSOR_MISSING', 'Production output sensor is not configured.')
  }

  const machineRecord = Array.isArray(sensorConfig.machines)
    ? sensorConfig.machines[0]
    : sensorConfig.machines

  const machine = {
    id: sensorConfig.machine_id || machineRecord?.id || null,
    code: machineRecord?.machine_code || 'M-01',
    name: machineRecord?.name || 'Spiral Mill 01',
  }
  const sensorLabel = getSensorLabel(OUTPUT_SENSOR_CODE, sensorConfig.label)
  const sensor = {
    id: sensorConfig.id,
    sensor_code: sensorConfig.sensor_code || OUTPUT_SENSOR_CODE,
    label: sensorLabel,
  }

  const report = await buildObservedProductionReport({
    type,
    selectedDate,
    machine,
    sensor,
    sensorLabel,
    window: observed.window,
    periodState: observed.periodState,
    asOf,
    suppliedClient: options.client,
  })

  if (!compare) return report

  const comparisonWindow = getComparisonWindow(type, requestedWindow, observed.periodState, asOf)
  const previousReport = await buildObservedProductionReport({
    type,
    selectedDate: formatBusinessDate(comparisonWindow.start),
    machine,
    sensor,
    sensorLabel,
    window: comparisonWindow,
    periodState: observed.periodState,
    asOf,
    suppliedClient: options.client,
  })

  return {
    ...report,
    comparison: {
      periodState: observed.periodState,
      observedStartAt: comparisonWindow.start.toISOString(),
      observedEndAt: comparisonWindow.end.toISOString(),
      metrics: {
        totalProductionOutput: previousReport.metrics.totalProductionOutput,
        specifiedPipes: previousReport.metrics.specifiedPipes,
        unspecifiedPipes: previousReport.metrics.unspecifiedPipes,
        distinctProductSizes: previousReport.metrics.distinctProductSizes,
      },
    },
  }
}

async function getSummary({ category = 'regular', type = 'daily', date, compare = false } = {}, options = {}) {
  if (category === 'production') {
    return getProductionSummary({ type, date, compare }, options)
  }

  const asOf = options.asOf || new Date()
  const machine = await getMachine()
  const selectedDate = date || formatBusinessDate(asOf)
  const requestedWindow = getWindow(type, selectedDate)
  const observed = getObservedWindow(requestedWindow, asOf)
  if (!observed.window) {
    return compare
      ? { ...getUnobservedReport(type, selectedDate, asOf), comparison: null }
      : getUnobservedReport(type, selectedDate, asOf)
  }

  const lossEstimateBasis = await getOutputLossBasis({
    machineId: machine.id,
    asOf,
    fallbackRatePiecesPerMinute: env.OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE,
  })
  const report = await buildObservedReport({
    type,
    selectedDate,
    machine,
    window: observed.window,
    periodState: observed.periodState,
    asOf,
    lossEstimateBasis,
  })

  if (!compare) return report

  const comparisonWindow = getComparisonWindow(type, requestedWindow, observed.periodState, asOf)
  const previousReport = await buildObservedReport({
    type,
    selectedDate: formatBusinessDate(comparisonWindow.start),
    machine,
    window: comparisonWindow,
    periodState: observed.periodState,
    asOf,
    lossEstimateBasis,
  })

  return {
    ...report,
    comparison: {
      periodState: observed.periodState,
      observedStartAt: comparisonWindow.start.toISOString(),
      observedEndAt: comparisonWindow.end.toISOString(),
      metrics: {
        outputPieces: previousReport.metrics.outputPieces,
        availabilityPercent: previousReport.metrics.availabilityPercent,
        estimatedLoss: previousReport.metrics.estimatedLoss,
      },
    },
  }
}

module.exports = {
  getSummary,
}
