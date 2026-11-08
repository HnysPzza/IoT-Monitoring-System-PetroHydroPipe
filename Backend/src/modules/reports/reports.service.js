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
const {
  getSensorLabel,
  OUTPUT_SENSOR_CODE,
  PROCESS_SENSOR_CODES,
} = require('../../shared/sensorIdentity')
const {
  attributeMachineDowntime,
  calculateMachineMetrics,
  toMinutes,
} = require('../../shared/operationalMetrics')
const { getOverlappingDowntime } = require('../downtime/downtime.repository')
const { getSettingsHistory } = require('../settings/settingsHistory.repository')
const { aggregateSensorEvents } = require('../../shared/sensorEventAggregation.repository')
const { getOutputLossBasis } = require('../../shared/outputLossBasis')
const { calculatePipeTonnage } = require('../production/production.service')
const reportsRepository = require('./reports.repository')

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

// ponytail: single machine monitoring ceiling: 1 machine (M-01) upgrade: multi-machine selector
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

async function buildObservedReport({ type, selectedDate, machine, window, periodState, asOf, lossBasisPromise }) {
  const [eventSummary, downtimeRows, settingsHistory, lossEstimateBasis] = await Promise.all([
    getEventSummary(machine.id, window),
    getOverlappingDowntime(machine.id, window),
    getSettingsHistory(machine.id, window),
    lossBasisPromise,
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

function parsePositiveDimension(val) {
  if (val == null) return null
  if (typeof val === 'string' && val.trim() === '') return null
  const num = Number(val)
  return Number.isFinite(num) && num > 0 ? num : null
}

function checkIsSpecified(spec) {
  if (!spec) return false
  const hasCustomer = spec.customer != null && String(spec.customer).trim() !== ''
  const hasDiameter = parsePositiveDimension(spec.diameter) !== null
  const hasThickness = parsePositiveDimension(spec.thickness) !== null
  const hasLength = parsePositiveDimension(spec.length) !== null
  const hasPipeNumber = spec.pipe_number != null || spec.pipeNumber != null
  const hasTonnage = parsePositiveDimension(spec.tonnage) !== null
  const hasLabel = spec.label != null && String(spec.label).trim() !== ''
  const hasSize = spec.size != null && String(spec.size).trim() !== ''
  return (
    hasCustomer ||
    hasDiameter ||
    hasThickness ||
    hasLength ||
    hasPipeNumber ||
    hasTonnage ||
    hasLabel ||
    hasSize ||
    parsePositiveDimension(spec.radius) !== null ||
    parsePositiveDimension(spec.circumference) !== null
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
    machine: {
      id: null,
      code: 'M-01',
      name: 'Spiral Mill 01',
    },
    sensor: {
      id: null,
      code: OUTPUT_SENSOR_CODE,
      label: getSensorLabel(OUTPUT_SENSOR_CODE),
    },
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'total-tonnage', label: 'Total Production Tonnage (tons)', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'specified-pipes', label: 'Specified Pipes', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: 'N/A', helper: 'Period not reached yet' },
      { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: 'N/A', helper: 'Period not reached yet' },
    ],
    metrics: {
      totalProductionOutput: null,
      totalTonnage: null,
      specifiedPipes: null,
      unspecifiedPipes: null,
      distinctProductSizes: null,
    },
    totalProductionOutput: null,
    totalTonnage: null,
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
  metricsOnly = false,
  maxLogs = 200,
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
  let accumulatedTonnage = 0
  const productionLogs = []

  const dailyPipeSequenceByEventId = new Map()
  const eventsByDay = new Map()
  for (const event of sortedEvents) {
    const dayKey = formatBusinessDate(event.recorded_at)
    if (!eventsByDay.has(dayKey)) {
      eventsByDay.set(dayKey, [])
    }
    eventsByDay.get(dayKey).push(event)
  }
  for (const [, dayEvents] of eventsByDay.entries()) {
    dayEvents.sort((a, b) => {
      const timeDiff = new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      if (timeDiff !== 0) return timeDiff
      return String(a.id || '').localeCompare(String(b.id || ''))
    })
    dayEvents.forEach((event, idx) => {
      dailyPipeSequenceByEventId.set(event.id, idx + 1)
    })
  }

  for (const event of sortedEvents) {
    const spec = event.spec
    const isSpecified = checkIsSpecified(spec)

    const customer = spec?.customer != null && String(spec.customer).trim() !== '' ? String(spec.customer).trim() : null
    const diameter = parsePositiveDimension(spec?.diameter)
    const thickness = parsePositiveDimension(spec?.thickness)
    const length = parsePositiveDimension(spec?.length)
    const rawPipeNumber = spec?.pipe_number != null
      ? Number(spec.pipe_number)
      : (spec?.pipeNumber != null ? Number(spec.pipeNumber) : null)
    const pipeNumber = rawPipeNumber !== null
      ? rawPipeNumber
      : (dailyPipeSequenceByEventId.get(event.id) ?? null)
    const explicitTonnage = parsePositiveDimension(spec?.tonnage)
    const singleTonnage = explicitTonnage ?? calculatePipeTonnage(diameter, thickness, length)

    const label = spec?.label != null && String(spec.label).trim() !== '' ? String(spec.label).trim() : null
    const size = spec?.size != null && String(spec.size).trim() !== '' ? String(spec.size).trim() : null
    const radius = parsePositiveDimension(spec?.radius)
    const circumference = parsePositiveDimension(spec?.circumference)

    if (isSpecified) {
      specifiedPipes += 1
      if (singleTonnage != null) {
        accumulatedTonnage += singleTonnage
      }

      if (!metricsOnly) {
        const groupKey = JSON.stringify([
          customer,
          diameter,
          thickness,
          length,
          (!customer && diameter == null && thickness == null && length == null) ? (size || label) : null,
        ])
        const existing = groupsMap.get(groupKey)

        if (existing) {
          existing.pipeCount += 1
          existing.lastCutAt = event.recorded_at
          if (singleTonnage != null) {
            existing.sumTonnage = (existing.sumTonnage ?? 0) + singleTonnage
          }
        } else {
          groupsMap.set(groupKey, {
            customer,
            diameter,
            thickness,
            length,
            singleTonnage,
            sumTonnage: singleTonnage ?? null,
            label,
            size,
            isSpecified: true,
            pipeCount: 1,
            firstCutAt: event.recorded_at,
            lastCutAt: event.recorded_at,
          })
        }
      }

      let distinctSizeKey = null
      if (diameter != null || thickness != null || length != null) {
        distinctSizeKey = JSON.stringify(['dims', diameter, thickness, length])
      } else if (customer) {
        distinctSizeKey = JSON.stringify(['customer', customer])
      } else if (size) {
        distinctSizeKey = JSON.stringify(['legacy-size', size])
      } else if (radius != null || circumference != null) {
        distinctSizeKey = JSON.stringify(['legacy-circle', radius, circumference])
      } else if (label) {
        distinctSizeKey = JSON.stringify(['legacy-label', label])
      }
      if (distinctSizeKey) {
        distinctSizes.add(distinctSizeKey)
      }
    } else {
      unspecifiedPipes += 1
      if (!metricsOnly) {
        if (unspecifiedGroup) {
          unspecifiedGroup.pipeCount += 1
          unspecifiedGroup.lastCutAt = event.recorded_at
        } else {
          unspecifiedGroup = {
            customer: 'Unspecified / Pending Tag',
            diameter: null,
            thickness: null,
            length: null,
            singleTonnage: null,
            totalTonnage: null,
            label: 'Unspecified / Pending Tag',
            size: null,
            isSpecified: false,
            pipeCount: 1,
            firstCutAt: event.recorded_at,
            lastCutAt: event.recorded_at,
          }
        }
      }
    }

    if (!metricsOnly) {
      productionLogs.push({
        id: event.id,
        sensorEventId: event.id,
        deviceEventId: event.device_event_id ?? null,
        recordedAt: event.recorded_at,
        customer,
        diameter,
        thickness,
        length,
        pipeNumber,
        tonnage: singleTonnage,
        label,
        size,
        radius,
        circumference,
        isSpecified,
        updatedBy: spec?.updated_by ?? null,
      })
    }
  }

  const totalProductionOutput = sortedEvents.length
  const totalTonnage = Math.round(accumulatedTonnage * 10000) / 10000

  const specBreakdown = metricsOnly ? [] : Array.from(groupsMap.values())
    .map(({ sumTonnage, ...group }) => ({
      ...group,
      totalTonnage: sumTonnage != null
        ? Math.round(sumTonnage * 10000) / 10000
        : (group.singleTonnage != null
          ? Math.round(group.singleTonnage * group.pipeCount * 10000) / 10000
          : null),
      percentageOfTotal: totalProductionOutput > 0
        ? Number(((group.pipeCount / totalProductionOutput) * 100).toFixed(1))
        : 0,
    }))
    .sort((a, b) => {
      if (b.pipeCount !== a.pipeCount) return b.pipeCount - a.pipeCount
      const custComp = String(a.customer || '').localeCompare(String(b.customer || ''))
      if (custComp !== 0) return custComp
      const diamComp = (a.diameter ?? 0) - (b.diameter ?? 0)
      if (diamComp !== 0) return diamComp
      const thickComp = (a.thickness ?? 0) - (b.thickness ?? 0)
      if (thickComp !== 0) return thickComp
      return (a.length ?? 0) - (b.length ?? 0)
    })

  if (!metricsOnly && unspecifiedGroup) {
    unspecifiedGroup.percentageOfTotal = totalProductionOutput > 0
      ? Number(((unspecifiedGroup.pipeCount / totalProductionOutput) * 100).toFixed(1))
      : 0
    specBreakdown.push(unspecifiedGroup)
  }

  const returnedLogs = (!metricsOnly && maxLogs && maxLogs > 0 && productionLogs.length > maxLogs)
    ? productionLogs.slice(-maxLogs)
    : productionLogs

  const metrics = {
    totalProductionOutput,
    totalTonnage,
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
      id: 'total-tonnage',
      label: 'Total Production Tonnage (tons)',
      value: `${totalTonnage.toFixed(4)} tons`,
      helper: 'Calculated metric tons',
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
    totalTonnage,
    specifiedPipes,
    unspecifiedPipes,
    distinctProductSizes: distinctSizes.size,
    specBreakdown,
    productionLogs: returnedLogs,
    rows: returnedLogs,
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

  const reportPromise = buildObservedProductionReport({
    type,
    selectedDate,
    machine,
    sensor,
    sensorLabel,
    window: observed.window,
    periodState: observed.periodState,
    asOf,
    suppliedClient: options.client,
    maxLogs: options.maxLogs !== undefined ? options.maxLogs : 200,
  })

  if (!compare) return reportPromise

  const comparisonWindow = getComparisonWindow(type, requestedWindow, observed.periodState, asOf)
  const [report, previousReport] = await Promise.all([reportPromise, buildObservedProductionReport({
    type,
    selectedDate: formatBusinessDate(comparisonWindow.start),
    machine,
    sensor,
    sensorLabel,
    window: comparisonWindow,
    periodState: observed.periodState,
    asOf,
    suppliedClient: options.client,
    metricsOnly: true,
  })])

  return {
    ...report,
    comparison: {
      periodState: observed.periodState,
      observedStartAt: comparisonWindow.start.toISOString(),
      observedEndAt: comparisonWindow.end.toISOString(),
      metrics: {
        totalProductionOutput: previousReport.metrics.totalProductionOutput,
        totalTonnage: previousReport.metrics.totalTonnage,
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

  const lossBasisPromise = getOutputLossBasis({
    machineId: machine.id,
    asOf,
    fallbackRatePiecesPerMinute: env.OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE,
  })
  const reportPromise = buildObservedReport({
    type,
    selectedDate,
    machine,
    window: observed.window,
    periodState: observed.periodState,
    asOf,
    lossBasisPromise,
  })

  if (!compare) return reportPromise

  const comparisonWindow = getComparisonWindow(type, requestedWindow, observed.periodState, asOf)
  const [report, previousReport] = await Promise.all([reportPromise, buildObservedReport({
    type,
    selectedDate: formatBusinessDate(comparisonWindow.start),
    machine,
    window: comparisonWindow,
    periodState: observed.periodState,
    asOf,
    lossBasisPromise,
  })])

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
