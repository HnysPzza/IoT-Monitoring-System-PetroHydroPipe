import { apiRequest } from '../../../shared/services/apiClient.js'

const DAY_MS = 24 * 60 * 60 * 1000
const ANALYTICS_TIME_ZONE = 'Asia/Manila'
const BUCKETS = new Set(['four-hour', 'daily', 'weekly', 'monthly'])
const PERIOD_STATES = new Set(['future', 'partial', 'complete'])
const ALIGNMENT_MODES = new Set(['ordinal-equal-duration-buckets', 'ordinal-calendar-segments'])
const LOSS_BASIS_SOURCES = new Set(['trailing-7-days', 'trailing-30-days', 'configured-fallback'])
const SUMMARY_METRICS = [
  'downtimeMinutes',
  'downtimeEventCount',
  'availabilityPercent',
  'outputPieces',
  'processEventCount',
  'estimatedLossPieces',
]
const TREND_METRICS = SUMMARY_METRICS.filter((metric) => metric !== 'downtimeEventCount')
const PROCESS_SENSOR_CODES = new Set(['S-01', 'S-02', 'S-04'])

function parseDateInput(value, fieldName = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`A valid ${fieldName} is required.`)
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`A valid ${fieldName} is required.`)
  }

  return date
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date, amount) {
  const nextDate = new Date(date.getTime())
  nextDate.setUTCDate(nextDate.getUTCDate() + amount)
  return nextDate
}

function getMondayStart(date) {
  const weekday = date.getUTCDay()
  return addUtcDays(date, -(weekday === 0 ? 6 : weekday - 1))
}

function getAutomaticBucket(daysInclusive) {
  if (daysInclusive <= 2) return 'four-hour'
  if (daysInclusive <= 14) return 'daily'
  if (daysInclusive <= 93) return 'weekly'
  return 'monthly'
}

export function getManilaDateInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function resolveAnalyticsRange({
  period = 'this-week',
  startDate,
  endDate,
  referenceDate = getManilaDateInputValue(),
} = {}) {
  const reference = parseDateInput(referenceDate, 'reference date')
  let start
  let end

  if (period === 'this-week') {
    start = getMondayStart(reference)
    end = addUtcDays(start, 6)
  } else if (period === 'this-month') {
    start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1))
    end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0))
  } else if (period === 'all') {
    return { period, range: 'all', bucket: 'monthly' }
  } else if (period === 'custom') {
    start = parseDateInput(startDate, 'start date')
    end = parseDateInput(endDate, 'end date')
  } else {
    throw new RangeError('Select a supported Analytics date range.')
  }

  if (end < start) throw new RangeError('The end date must be on or after the start date.')

  const daysInclusive = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  if (daysInclusive > 366) throw new RangeError('Analytics date range must be 1 to 366 days.')
  return {
    period,
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    daysInclusive,
    bucket: getAutomaticBucket(daysInclusive),
  }
}

function isMetricValue(metric, value) {
  if (value === null) return true
  if (metric === 'availabilityPercent') return Number.isInteger(value) && value >= 0 && value <= 100
  if (metric === 'downtimeEventCount' || metric === 'outputPieces' || metric === 'processEventCount') {
    return Number.isInteger(value) && value >= 0
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isDateTimeOrNull(value) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function isLossEstimateBasis(value) {
  return Boolean(
    value
    && LOSS_BASIS_SOURCES.has(value.source)
    && Number.isFinite(value.ratePiecesPerMinute)
    && value.ratePiecesPerMinute > 0
    && typeof value.windowStartAt === 'string'
    && Number.isFinite(Date.parse(value.windowStartAt))
    && typeof value.windowEndAt === 'string'
    && Number.isFinite(Date.parse(value.windowEndAt))
    && Date.parse(value.windowStartAt) < Date.parse(value.windowEndAt)
    && Number.isInteger(value.qualifiedProductionDays)
    && value.qualifiedProductionDays >= 0
    && Number.isFinite(value.productiveMinutes)
    && value.productiveMinutes >= 0
    && Number.isInteger(value.outputPieces)
    && value.outputPieces >= 0,
  )
}

function isSummary(value, metricNames = SUMMARY_METRICS) {
  return value && metricNames.every((metric) => isMetricValue(metric, value[metric]))
}

function isCauseCoverage(value, periodState) {
  const metrics = [
    value?.reviewedDurationMinutes,
    value?.pendingReviewDurationMinutes,
    value?.pendingReviewEventCount,
    value?.coveragePercent,
  ]
  if (periodState === 'future') return metrics.every((metric) => metric === null)
  return metrics.every((metric) => Number.isInteger(metric) && metric >= 0)
    && value.coveragePercent <= 100
}

function hasExactSensorCodes(sensors, expectedCodes) {
  return sensors.length === expectedCodes.size
    && sensors.every((sensor) => expectedCodes.has(sensor?.sensorCode))
    && new Set(sensors.map((sensor) => sensor.sensorCode)).size === sensors.length
}

function isRange(value) {
  return Boolean(
    value
    && /^\d{4}-\d{2}-\d{2}$/.test(value.requestedStartDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(value.requestedEndDate)
    && isDateTimeOrNull(value.observedStartAt)
    && isDateTimeOrNull(value.observedEndAt)
    && PERIOD_STATES.has(value.periodState)
    && Number.isInteger(value.daysInclusive)
    && value.daysInclusive >= 1
    && BUCKETS.has(value.bucket),
  )
}

function isTrendPoint(value) {
  return Boolean(
    value
    && typeof value.key === 'string'
    && typeof value.label === 'string'
    && isDateTimeOrNull(value.startAt)
    && isDateTimeOrNull(value.endAt)
    && PERIOD_STATES.has(value.periodState)
    && isSummary(value.metrics, TREND_METRICS),
  )
}

function isPeriod(value) {
  return Boolean(
    value
    && isRange(value.range)
    && isSummary(value.summary)
    && isCauseCoverage(value.causeCoverage, value.range.periodState)
    && Array.isArray(value.trends)
    && value.trends.every(isTrendPoint)
    && Array.isArray(value.downtimeCauses)
    && value.downtimeCauses.every((cause) => (
      typeof cause?.cause === 'string' && cause.cause.trim().length > 0
      && cause.cause !== 'Pending Cause Review'
      && Number.isInteger(cause.eventCount) && cause.eventCount >= 0
      && Number.isFinite(cause.durationMinutes) && cause.durationMinutes >= 0
      && Number.isFinite(cause.estimatedLossPieces) && cause.estimatedLossPieces >= 0
    ))
    && Array.isArray(value.processSensors)
    && hasExactSensorCodes(value.processSensors, PROCESS_SENSOR_CODES)
    && value.processSensors.every((sensor) => (
      typeof sensor.sensorLabel === 'string' && sensor.sensorLabel.trim().length > 0
      && Number.isInteger(sensor.eventCount) && sensor.eventCount >= 0
    )),
  )
}

function isAnalyticsSnapshot(value) {
  const hasComparison = value?.comparisonMode === 'immediately-preceding-matching-elapsed'
  const hasNoComparison = value?.comparisonMode === 'none'
  return Boolean(
    value
    && typeof value.generatedAt === 'string'
    && Number.isFinite(Date.parse(value.generatedAt))
    && value.timeZone === ANALYTICS_TIME_ZONE
    && isLossEstimateBasis(value.lossEstimateBasis)
    && typeof value.coverage?.historicalHeartbeatAvailable === 'boolean'
    && typeof value.coverage.message === 'string'
    && (hasComparison || hasNoComparison)
    && new Set(['all', 'dates']).has(value.selectionMode)
    && ((value.selectionMode === 'all' && hasNoComparison) || (value.selectionMode === 'dates' && hasComparison))
    && typeof value.comparisonClipped === 'boolean'
    && (!hasNoComparison || value.comparisonClipped === false)
    && ALIGNMENT_MODES.has(value.trendAlignment?.mode)
    && Number.isInteger(value.trendAlignment.selectedBucketCount)
    && Number.isInteger(value.trendAlignment.comparisonBucketCount)
    && value.trendAlignment.selectedBucketCount >= 0
    && value.trendAlignment.comparisonBucketCount >= 0
    && isPeriod(value.selected)
    && (hasComparison ? isPeriod(value.comparison) : value.comparison === null)
    && value.trendAlignment.selectedBucketCount === value.selected.trends.length
    && value.trendAlignment.comparisonBucketCount === (value.comparison?.trends.length || 0),
  )
}

export async function getAnalyticsSnapshot(token, options = {}, { signal } = {}) {
  const range = resolveAnalyticsRange(options)
  const query = range.range === 'all'
    ? new URLSearchParams({ range: 'all' })
    : new URLSearchParams({ startDate: range.startDate, endDate: range.endDate })
  const payload = await apiRequest(`/api/analytics?${query.toString()}`, {
    token,
    ...(signal ? { signal } : {}),
    fallbackError: 'Unable to load Analytics.',
  })

  if (!isAnalyticsSnapshot(payload?.analytics)) {
    throw new Error('The server returned an invalid Analytics response.')
  }

  return payload.analytics
}
