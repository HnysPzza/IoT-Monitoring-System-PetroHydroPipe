const { getSupabaseClient } = require('../../database/client')
const env = require('../../config/env')
const {
  BUSINESS_TIME_ZONE,
  addBusinessDays,
  formatBusinessDate,
  parseBusinessDate,
} = require('../../shared/businessTime')
const {
  attributeMachineDowntime,
  calculateMachineMetrics,
} = require('../../shared/operationalMetrics')
const { getOverlappingDowntime } = require('../downtime/downtime.repository')
const { getSettingsHistory } = require('../settings/settingsHistory.repository')
const { aggregateSensorEvents } = require('../../shared/sensorEventAggregation.repository')
const { getOutputLossBasis } = require('../../shared/outputLossBasis')

const DAY_MS = 86400000
const PROCESS_SENSOR_CODES = new Set(['S-01', 'S-02', 'S-04'])
const OUTPUT_SENSOR_CODE = 'S-05'

function createAnalyticsError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getBucketConfig(daysInclusive) {
  if (daysInclusive <= 2) return { bucket: 'four-hour', seconds: 14400 }
  if (daysInclusive <= 14) return { bucket: 'daily', seconds: 86400 }
  if (daysInclusive <= 93) return { bucket: 'weekly', seconds: 604800 }
  return { bucket: 'monthly', seconds: 0 }
}

function getPeriodState(start, end, asOf) {
  if (asOf <= start) return 'future'
  if (asOf < end) return 'partial'
  return 'complete'
}

function createRange(start, end, requestedStartDate, requestedEndDate, asOf, bucket) {
  const periodState = getPeriodState(start, end, asOf)
  const observedEnd = periodState === 'future' ? null : new Date(Math.min(end.getTime(), asOf.getTime()))
  return {
    start,
    end,
    observedEnd,
    api: {
      requestedStartDate,
      requestedEndDate,
      observedStartAt: periodState === 'future' ? null : start.toISOString(),
      observedEndAt: observedEnd?.toISOString() || null,
      periodState,
      daysInclusive: Math.round((end - start) / DAY_MS),
      bucket,
    },
  }
}

function formatBucketLabel(start, end, bucket) {
  if (bucket === 'four-hour') {
    const time = start.toLocaleTimeString('en-PH', {
      timeZone: BUSINESS_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    return `${formatBusinessDate(start)} ${time}`
  }
  const lastObservedDate = formatBusinessDate(new Date(end.getTime() - 1))
  const firstDate = formatBusinessDate(start)
  return firstDate === lastObservedDate ? firstDate : `${firstDate} – ${lastObservedDate}`
}

function buildBuckets(range, bucketConfig, asOf) {
  const buckets = []
  if (bucketConfig.bucket === 'monthly') {
    let cursor = new Date(range.start)
    while (cursor < range.end) {
      const dateKey = formatBusinessDate(cursor)
      const [year, month] = dateKey.split('-').map(Number)
      const nextMonth = new Date(Date.UTC(year, month, 1))
      const nextMonthDate = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`
      const end = new Date(Math.min(parseBusinessDate(nextMonthDate).getTime(), range.end.getTime()))
      const periodState = getPeriodState(cursor, end, asOf)
      buckets.push({
        key: cursor.toISOString(),
        label: formatBucketLabel(cursor, end, bucketConfig.bucket),
        start: cursor,
        end,
        observedEnd: periodState === 'future' ? null : new Date(Math.min(end.getTime(), asOf.getTime())),
        periodState,
      })
      cursor = end
    }
    return buckets
  }
  const stepMs = bucketConfig.seconds * 1000
  for (let cursor = range.start.getTime(); cursor < range.end.getTime(); cursor += stepMs) {
    const start = new Date(cursor)
    const end = new Date(Math.min(cursor + stepMs, range.end.getTime()))
    const periodState = getPeriodState(start, end, asOf)
    buckets.push({
      key: start.toISOString(),
      label: formatBucketLabel(start, end, bucketConfig.bucket),
      start,
      end,
      observedEnd: periodState === 'future' ? null : new Date(Math.min(end.getTime(), asOf.getTime())),
      periodState,
    })
  }
  return buckets
}

function emptySummary() {
  return {
    downtimeMinutes: null,
    downtimeEventCount: null,
    availabilityPercent: null,
    outputPieces: null,
    processEventCount: null,
    estimatedLossPieces: null,
  }
}

function emptyCauseCoverage() {
  return {
    reviewedDurationMinutes: null,
    pendingReviewDurationMinutes: null,
    pendingReviewEventCount: null,
    coveragePercent: null,
  }
}

function countEvents(rows) {
  return rows.reduce((totals, row) => {
    const count = Number(row.event_count || 0)
    if (row.sensor_code === OUTPUT_SENSOR_CODE) totals.outputPieces += count
    if (PROCESS_SENSOR_CODES.has(row.sensor_code)) totals.processEventCount += count
    return totals
  }, { outputPieces: 0, processEventCount: 0 })
}

function rowsForBucket(rows, bucket, bucketType) {
  if (bucketType === 'monthly') {
    const month = formatBusinessDate(bucket.start).slice(0, 7)
    return rows.filter((row) => formatBusinessDate(new Date(row.bucket_start)).slice(0, 7) === month)
  }
  return rows.filter((row) => new Date(row.bucket_start).getTime() === bucket.start.getTime())
}

function buildProcessSensors(rows, configuredSensors) {
  const totals = new Map(
    configuredSensors
      .filter((sensor) => PROCESS_SENSOR_CODES.has(sensor.sensor_code))
      .map((sensor) => [sensor.sensor_code, {
        sensorCode: sensor.sensor_code,
        sensorLabel: sensor.label,
        eventCount: 0,
      }]),
  )
  rows.forEach((row) => {
    if (!PROCESS_SENSOR_CODES.has(row.sensor_code)) return
    const current = totals.get(row.sensor_code) || {
      sensorCode: row.sensor_code,
      sensorLabel: row.sensor_label,
      eventCount: 0,
    }
    current.eventCount += Number(row.event_count || 0)
    totals.set(row.sensor_code, current)
  })
  return [...totals.values()].sort((left, right) => left.sensorCode.localeCompare(right.sensorCode))
}

function overlapsWindow(record, window, asOf) {
  const start = new Date(record.started_at)
  const end = record.ended_at ? new Date(record.ended_at) : asOf
  return start < window.end && end > window.start
}

function buildMetrics(
  records,
  window,
  settingsHistory,
  asOf,
  eventRows,
  lossRatePiecesPerMinute,
  suppliedMetrics,
) {
  const metrics = suppliedMetrics || calculateMachineMetrics({
    records,
    window,
    settingsHistory,
    asOf,
    lossRatePiecesPerMinute,
  })
  const counts = countEvents(eventRows)
  return {
    downtimeMinutes: metrics.durationMinutes,
    downtimeEventCount: records.filter((record) => overlapsWindow(record, window, asOf)).length,
    availabilityPercent: metrics.availabilityPercent,
    outputPieces: counts.outputPieces,
    processEventCount: counts.processEventCount,
    estimatedLossPieces: metrics.estimatedLoss,
  }
}

async function buildPeriod({ machine, range, bucketConfig, asOf, dependencies, lossRatePiecesPerMinute }) {
  if (range.api.periodState === 'future') {
    return {
      range: range.api,
      summary: emptySummary(),
      causeCoverage: emptyCauseCoverage(),
      trends: buildBuckets(range, bucketConfig, asOf).map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        startAt: bucket.start.toISOString(),
        endAt: bucket.end.toISOString(),
        periodState: 'future',
        metrics: emptySummary(),
      })),
      downtimeCauses: [],
      processSensors: buildProcessSensors([], machine.sensors),
    }
  }

  const observedWindow = { start: range.start, end: range.observedEnd }
  const [eventRows, downtimeRows, settingsHistory] = await Promise.all([
    dependencies.aggregateEvents(machine.id, observedWindow, bucketConfig.seconds),
    dependencies.getOverlappingDowntime(machine.id, observedWindow),
    dependencies.getSettingsHistory(machine.id, observedWindow),
  ])
  const totalMetrics = calculateMachineMetrics({
    records: downtimeRows,
    window: observedWindow,
    settingsHistory,
    asOf,
    lossRatePiecesPerMinute,
  })
  const summary = buildMetrics(
    downtimeRows,
    observedWindow,
    settingsHistory,
    asOf,
    eventRows,
    lossRatePiecesPerMinute,
    totalMetrics,
  )
  const reviewedDowntimeRows = downtimeRows.filter((record) => (
    record.cause && record.cause !== 'Pending Cause Review'
  ))
  const pendingReviewRows = downtimeRows.filter((record) => (
    !record.cause || record.cause === 'Pending Cause Review'
  ))
  const reviewedMetrics = calculateMachineMetrics({
    records: reviewedDowntimeRows,
    window: observedWindow,
    settingsHistory,
    asOf,
    lossRatePiecesPerMinute,
  })
  const pendingReviewMetrics = calculateMachineMetrics({
    records: pendingReviewRows,
    window: observedWindow,
    settingsHistory,
    asOf,
    lossRatePiecesPerMinute,
  })
  const causeCoverage = {
    reviewedDurationMinutes: reviewedMetrics.durationMinutes,
    pendingReviewDurationMinutes: pendingReviewMetrics.durationMinutes,
    pendingReviewEventCount: pendingReviewRows.length,
    coveragePercent: totalMetrics.durationSeconds === 0
      ? 100
      : Math.round((reviewedMetrics.durationSeconds / totalMetrics.durationSeconds) * 100),
  }
  const downtimeCausesByName = new Map()
  attributeMachineDowntime({
    records: reviewedDowntimeRows,
    window: observedWindow,
    settingsHistory,
    asOf,
    lossRatePiecesPerMinute,
  }).forEach((row) => {
    const current = downtimeCausesByName.get(row.cause) || {
      cause: row.cause,
      eventCount: 0,
      durationMinutes: 0,
      estimatedLossPieces: 0,
    }
    current.eventCount += row.events
    current.durationMinutes += row.durationMinutes
    current.estimatedLossPieces += row.estimatedLoss
    downtimeCausesByName.set(row.cause, current)
  })
  const downtimeCauses = [...downtimeCausesByName.values()]
    .map((row) => ({
      ...row,
      estimatedLossPieces: Number(row.estimatedLossPieces.toFixed(2)),
    }))
    .sort((left, right) => right.durationMinutes - left.durationMinutes)
  const trends = buildBuckets(range, bucketConfig, asOf).map((bucket) => {
    if (bucket.periodState === 'future') {
      return {
        key: bucket.key,
        label: bucket.label,
        startAt: bucket.start.toISOString(),
        endAt: bucket.end.toISOString(),
        periodState: 'future',
        metrics: emptySummary(),
      }
    }
    const window = { start: bucket.start, end: bucket.observedEnd }
    return {
      key: bucket.key,
      label: bucket.label,
      startAt: bucket.start.toISOString(),
      endAt: bucket.observedEnd.toISOString(),
      periodState: bucket.periodState,
      metrics: buildMetrics(
        downtimeRows,
        window,
        settingsHistory,
        asOf,
        rowsForBucket(eventRows, bucket, bucketConfig.bucket),
        lossRatePiecesPerMinute,
      ),
    }
  })

  return {
    range: range.api,
    summary,
    causeCoverage,
    trends,
    downtimeCauses,
    processSensors: buildProcessSensors(eventRows, machine.sensors),
  }
}

async function defaultGetMachineAndSensors() {
  const supabase = getSupabaseClient()
  const { data: machine, error: machineError } = await supabase
    .from('machines')
    .select('id, name')
    .eq('machine_code', 'M-01')
    .maybeSingle()
  if (machineError) throw createAnalyticsError(500, 'ANALYTICS_MACHINE_QUERY_FAILED', 'Unable to load the Analytics machine.')
  if (!machine) throw createAnalyticsError(404, 'MACHINE_NOT_FOUND', 'Spiral Mill 01 was not found.')

  const { data: sensors, error: sensorError } = await supabase
    .from('sensors')
    .select('sensor_code, label')
    .eq('machine_id', machine.id)
    .order('sensor_code', { ascending: true })
  if (sensorError) throw createAnalyticsError(500, 'ANALYTICS_SENSOR_QUERY_FAILED', 'Unable to load Analytics sensors.')
  const configuredCodes = new Set((sensors || []).map((sensor) => sensor.sensor_code))
  const missing = ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'].filter((code) => !configuredCodes.has(code))
  if (missing.length) throw createAnalyticsError(500, 'ANALYTICS_SENSOR_CONFIGURATION_INCOMPLETE', 'Analytics sensor configuration is incomplete.')
  return { ...machine, sensors }
}

async function defaultGetFirstRecordedAt(machineId) {
  const { data, error } = await getSupabaseClient().rpc('get_analytics_first_recorded_at', {
    p_machine_id: machineId,
  })
  if (error) throw createAnalyticsError(500, 'ANALYTICS_FIRST_RECORD_QUERY_FAILED', 'Unable to locate the first Analytics record.')
  return data ? new Date(data) : null
}

async function getAnalytics(query, suppliedDependencies = {}) {
  const asOf = suppliedDependencies.asOf ? new Date(suppliedDependencies.asOf) : new Date()
  const dependencies = {
    getMachineAndSensors: defaultGetMachineAndSensors,
    aggregateEvents: aggregateSensorEvents,
    getFirstRecordedAt: defaultGetFirstRecordedAt,
    getOverlappingDowntime,
    getSettingsHistory,
    getOutputLossBasis,
    ...suppliedDependencies,
  }
  const machine = await dependencies.getMachineAndSensors()
  const lossEstimateBasis = await dependencies.getOutputLossBasis({
    machineId: machine.id,
    asOf,
    fallbackRatePiecesPerMinute: env.OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE,
  })
  const selectionMode = query.range === 'all' ? 'all' : 'dates'
  const today = formatBusinessDate(asOf)
  const firstRecordedAt = selectionMode === 'all'
    ? await dependencies.getFirstRecordedAt(machine.id)
    : null
  const startDate = selectionMode === 'all'
    ? formatBusinessDate(firstRecordedAt || asOf)
    : query.startDate
  const endDate = selectionMode === 'all' ? today : query.endDate
  const selectedStart = parseBusinessDate(startDate)
  const selectedEnd = addBusinessDays(parseBusinessDate(endDate), 1)
  const daysInclusive = Math.round((selectedEnd - selectedStart) / DAY_MS)
  if (selectedStart >= selectedEnd || (selectionMode === 'dates' && daysInclusive > 366)) {
    throw createAnalyticsError(400, 'ANALYTICS_RANGE_INVALID', 'Analytics date range must be 1 to 366 days.')
  }

  const bucketConfig = getBucketConfig(daysInclusive)
  const comparisonStart = addBusinessDays(selectedStart, -daysInclusive)
  const comparisonEnd = selectedStart
  const selectedState = getPeriodState(selectedStart, selectedEnd, asOf)
  const comparisonAsOf = selectedState === 'partial'
    ? new Date(comparisonStart.getTime() + (asOf.getTime() - selectedStart.getTime()))
    : comparisonEnd
  const selectedRange = createRange(selectedStart, selectedEnd, startDate, endDate, asOf, bucketConfig.bucket)
  const comparisonRange = createRange(
    comparisonStart,
    comparisonEnd,
    formatBusinessDate(comparisonStart),
    formatBusinessDate(new Date(comparisonEnd.getTime() - 1)),
    comparisonAsOf,
    bucketConfig.bucket,
  )
  const selectedPromise = buildPeriod({
    machine,
    range: selectedRange,
    bucketConfig,
    asOf,
    dependencies,
    lossRatePiecesPerMinute: lossEstimateBasis.ratePiecesPerMinute,
  })
  const [selected, comparison] = selectionMode === 'all'
    ? [await selectedPromise, null]
    : await Promise.all([
      selectedPromise,
      buildPeriod({
        machine,
        range: comparisonRange,
        bucketConfig,
        asOf: comparisonAsOf,
        dependencies,
        lossRatePiecesPerMinute: lossEstimateBasis.ratePiecesPerMinute,
      }),
    ])

  return {
    generatedAt: asOf.toISOString(),
    timeZone: BUSINESS_TIME_ZONE,
    lossEstimateBasis,
    selectionMode,
    coverage: {
      historicalHeartbeatAvailable: false,
      message: 'Metrics use recorded system events and downtime records. Historical heartbeat completeness is not available.',
    },
    comparisonMode: selectionMode === 'all' ? 'none' : 'immediately-preceding-matching-elapsed',
    comparisonClipped: selectionMode !== 'all' && selectedState === 'partial',
    trendAlignment: {
      mode: bucketConfig.bucket === 'monthly'
        ? 'ordinal-calendar-segments'
        : 'ordinal-equal-duration-buckets',
      selectedBucketCount: selected.trends.length,
      comparisonBucketCount: comparison?.trends.length || 0,
    },
    selected,
    comparison,
  }
}

module.exports = { getAnalytics }
