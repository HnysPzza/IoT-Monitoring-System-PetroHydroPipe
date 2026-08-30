import { apiRequest } from '../../../shared/services/apiClient.js'

const DAY_MS = 24 * 60 * 60 * 1000
const ANALYTICS_TIME_ZONE = 'Asia/Manila'
const BUCKETS = new Set(['four-hour', 'daily', 'weekly', 'monthly'])
const PERIOD_STATES = new Set(['future', 'partial', 'complete'])
const ALIGNMENT_MODES = new Set(['ordinal-equal-duration-buckets', 'ordinal-calendar-segments'])
const SUMMARY_METRICS = [
  'downtimeMinutes',
  'downtimeEventCount',
  'availabilityPercent',
  'outputPieces',
  'processEventCount',
  'estimatedLossPieces',
]
const TREND_METRICS = SUMMARY_METRICS.filter((metric) => metric !== 'downtimeEventCount')

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

function isNullableFiniteNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isDateTimeOrNull(value) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)))
}

function isSummary(value, metricNames = SUMMARY_METRICS) {
  return value && metricNames.every((metric) => isNullableFiniteNumber(value[metric]))
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
    && Array.isArray(value.trends)
    && value.trends.every(isTrendPoint)
    && Array.isArray(value.downtimeCauses)
    && value.downtimeCauses.every((cause) => (
      typeof cause?.cause === 'string'
      && Number.isFinite(cause.eventCount)
      && Number.isFinite(cause.durationMinutes)
      && Number.isFinite(cause.estimatedLossPieces)
    ))
    && Array.isArray(value.downtimeSensors)
    && value.downtimeSensors.length <= 5
    && new Set(value.downtimeSensors.map((sensor) => sensor?.sensorCode)).size === value.downtimeSensors.length
    && value.downtimeSensors.every((sensor) => (
      typeof sensor?.sensorCode === 'string'
      && typeof sensor.sensorLabel === 'string'
      && Number.isFinite(sensor.eventCount)
      && Number.isFinite(sensor.durationMinutes)
    ))
    && Array.isArray(value.processSensors)
    && value.processSensors.every((sensor) => (
      typeof sensor?.sensorCode === 'string'
      && typeof sensor.sensorLabel === 'string'
      && Number.isFinite(sensor.eventCount)
    )),
  )
}

function isAnalyticsSnapshot(value) {
  return Boolean(
    value
    && typeof value.generatedAt === 'string'
    && Number.isFinite(Date.parse(value.generatedAt))
    && value.timeZone === ANALYTICS_TIME_ZONE
    && typeof value.coverage?.historicalHeartbeatAvailable === 'boolean'
    && typeof value.coverage.message === 'string'
    && value.comparisonMode === 'immediately-preceding-matching-elapsed'
    && new Set(['all', 'dates']).has(value.selectionMode)
    && typeof value.comparisonClipped === 'boolean'
    && ALIGNMENT_MODES.has(value.trendAlignment?.mode)
    && Number.isInteger(value.trendAlignment.selectedBucketCount)
    && Number.isInteger(value.trendAlignment.comparisonBucketCount)
    && isPeriod(value.selected)
    && isPeriod(value.comparison)
    && value.trendAlignment.selectedBucketCount === value.selected.trends.length
    && value.trendAlignment.comparisonBucketCount === value.comparison.trends.length,
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
