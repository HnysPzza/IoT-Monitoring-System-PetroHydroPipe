import { formatNumber } from '../../../shared/utils/formatters.js'

const DAY_MINUTES = 24 * 60

export const analyticsTrendMetrics = [
  {
    id: 'downtime',
    label: 'Downtime',
    unit: 'minutes',
    shortUnit: 'min',
    description: 'Minutes recorded in each automatic time bucket.',
  },
  {
    id: 'production',
    label: 'Output',
    unit: 'pieces',
    shortUnit: 'pcs',
    description: 'Output recorded in each automatic time bucket.',
  },
  {
    id: 'availability',
    label: 'Availability',
    unit: 'percent',
    shortUnit: '%',
    description: 'Availability calculated from the local downtime fixture for each automatic time bucket.',
  },
  {
    id: 'process-events',
    label: 'Process events',
    unit: 'events',
    shortUnit: 'events',
    description: 'Process event count in each automatic time bucket.',
  },
]

function parseDate(dateValue) {
  const [year, month, day] = String(dateValue).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  const nextDate = new Date(date.getTime())
  nextDate.setUTCDate(nextDate.getUTCDate() + days)
  return nextDate
}

function getMondayStart(date) {
  const weekday = date.getUTCDay()
  return addDays(date, -(weekday === 0 ? 6 : weekday - 1))
}

function minDate(left, right) {
  return left <= right ? left : right
}

function maxDate(left, right) {
  return left >= right ? left : right
}

function getDateLabel(dateValue, options = {}) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    month: 'short',
    day: '2-digit',
    ...options,
  }).format(parseDate(dateValue))
}

function getRangeLabel(startDate, endDate) {
  if (startDate === endDate) return getDateLabel(startDate)
  return `${getDateLabel(startDate)} - ${getDateLabel(endDate)}`
}

function createDateBucket(startDate, endDate, label = getRangeLabel(startDate, endDate)) {
  const daysInclusive = Math.floor((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 86400000) + 1

  return {
    key: `${startDate}:${endDate}`,
    label,
    startDate,
    endDate,
    capacityMinutes: daysInclusive * DAY_MINUTES,
  }
}

function buildFourHourBuckets(range) {
  const buckets = []
  let date = parseDate(range.startDate)
  const end = parseDate(range.endDate)

  while (date <= end) {
    const dateValue = toDateInput(date)

    for (let hour = 0; hour < 24; hour += 4) {
      const hourLabel = `${String(hour).padStart(2, '0')}:00`
      buckets.push({
        key: `${dateValue}T${String(hour).padStart(2, '0')}`,
        label: `${getDateLabel(dateValue)} ${hourLabel}`,
        startDate: dateValue,
        endDate: dateValue,
        startHour: hour,
        endHour: hour + 3,
        capacityMinutes: 4 * 60,
      })
    }

    date = addDays(date, 1)
  }

  return buckets
}

function buildDailyBuckets(range) {
  const buckets = []
  let date = parseDate(range.startDate)
  const end = parseDate(range.endDate)

  while (date <= end) {
    const dateValue = toDateInput(date)
    buckets.push(createDateBucket(dateValue, dateValue))
    date = addDays(date, 1)
  }

  return buckets
}

function buildWeeklyBuckets(range) {
  const buckets = []
  const rangeStart = parseDate(range.startDate)
  const rangeEnd = parseDate(range.endDate)
  let weekStart = getMondayStart(rangeStart)

  while (weekStart <= rangeEnd) {
    const weekEnd = addDays(weekStart, 6)
    const bucketStart = maxDate(weekStart, rangeStart)
    const bucketEnd = minDate(weekEnd, rangeEnd)
    buckets.push(createDateBucket(toDateInput(bucketStart), toDateInput(bucketEnd)))
    weekStart = addDays(weekStart, 7)
  }

  return buckets
}

function buildMonthlyBuckets(range) {
  const buckets = []
  const rangeStart = parseDate(range.startDate)
  const rangeEnd = parseDate(range.endDate)
  let monthStart = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1))

  while (monthStart <= rangeEnd) {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0))
    const bucketStart = maxDate(monthStart, rangeStart)
    const bucketEnd = minDate(monthEnd, rangeEnd)
    buckets.push(createDateBucket(
      toDateInput(bucketStart),
      toDateInput(bucketEnd),
      new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(monthStart),
    ))
    monthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  }

  return buckets
}

export function getAnalyticsTrendMetric(metricId) {
  return analyticsTrendMetrics.find((metric) => metric.id === metricId) || analyticsTrendMetrics[0]
}

export function buildAnalyticsBuckets(range) {
  if (range.bucket === 'four-hour') return buildFourHourBuckets(range)
  if (range.bucket === 'daily') return buildDailyBuckets(range)
  if (range.bucket === 'weekly') return buildWeeklyBuckets(range)
  return buildMonthlyBuckets(range)
}

function getEventHour(value) {
  const match = String(value).match(/T(\d{2}):/)
  return match ? Number(match[1]) : 0
}

function findBucket(buckets, dateValue, hour) {
  return buckets.find((bucket) => (
    dateValue >= bucket.startDate
    && dateValue <= bucket.endDate
    && (bucket.startHour === undefined || (dateValue === bucket.startDate && hour >= bucket.startHour && hour <= bucket.endHour))
  ))
}

function sumByBucket(buckets, rows, dateKey, getValue) {
  const totals = new Map(buckets.map((bucket) => [bucket.key, 0]))

  rows.forEach((row) => {
    const value = row[dateKey]
    const bucket = findBucket(buckets, String(value).slice(0, 10), getEventHour(value))
    if (bucket) totals.set(bucket.key, totals.get(bucket.key) + getValue(row))
  })

  return totals
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10
}

export function getAnalyticsKpis(snapshot) {
  const downtimeMinutes = snapshot.downtimeEvents.reduce((total, event) => total + Number(event.durationMinutes || 0), 0)
  const totalPieces = snapshot.productionRecords.reduce((total, record) => total + Number(record.actualPieces || 0), 0)
  const processEventCount = snapshot.processEvents.length
  const availableMinutes = Math.max(0, (snapshot.range.daysInclusive * DAY_MINUTES) - downtimeMinutes)
  const availability = snapshot.range.daysInclusive
    ? roundToOneDecimal((availableMinutes / (snapshot.range.daysInclusive * DAY_MINUTES)) * 100)
    : 0

  return [
    {
      id: 'downtime',
      label: 'Downtime',
      value: `${formatNumber(downtimeMinutes)} min`,
      helper: `${formatNumber(snapshot.downtimeEvents.length)} recorded event${snapshot.downtimeEvents.length === 1 ? '' : 's'}`,
    },
    {
      id: 'availability',
      label: 'Availability',
      value: `${availability.toFixed(1)}%`,
      helper: 'Calculated from local downtime records',
    },
    {
      id: 'production',
      label: 'Output',
      value: `${formatNumber(totalPieces)} pcs`,
      helper: 'Recorded local production output',
    },
    {
      id: 'process-events',
      label: 'Process events',
      value: formatNumber(processEventCount),
      helper: 'Count from the local process fixture',
    },
  ]
}

export function buildAnalyticsTrend(snapshot, metricId = 'downtime') {
  const metric = getAnalyticsTrendMetric(metricId)
  // Production fixture rows are date-only. Do not invent a midnight timestamp
  // when a short selected range otherwise uses four-hour operational buckets.
  const bucket = metric.id === 'production' && snapshot.range.bucket === 'four-hour'
    ? 'daily'
    : snapshot.range.bucket
  const buckets = buildAnalyticsBuckets({ ...snapshot.range, bucket })
  const downtimeTotals = sumByBucket(buckets, snapshot.downtimeEvents, 'startedAt', (event) => Number(event.durationMinutes || 0))
  const productionTotals = sumByBucket(buckets, snapshot.productionRecords, 'date', (record) => Number(record.actualPieces || 0))
  const processTotals = sumByBucket(buckets, snapshot.processEvents, 'occurredAt', () => 1)

  const points = buckets.map((bucket) => {
    const downtimeMinutes = downtimeTotals.get(bucket.key) || 0
    let value = downtimeMinutes

    if (metric.id === 'production') value = productionTotals.get(bucket.key) || 0
    if (metric.id === 'process-events') value = processTotals.get(bucket.key) || 0
    if (metric.id === 'availability') {
      value = roundToOneDecimal(Math.max(0, ((bucket.capacityMinutes - downtimeMinutes) / bucket.capacityMinutes) * 100))
    }

    return {
      ...bucket,
      value,
      downtimeMinutes,
    }
  })

  return {
    metric,
    points,
    bucket,
    usesDailyProductionFallback: metric.id === 'production' && snapshot.range.bucket === 'four-hour',
  }
}

export function formatAnalyticsTrendValue(value, metric) {
  if (metric.unit === 'percent') return `${Number(value).toFixed(1)}%`
  return `${formatNumber(value)} ${metric.shortUnit}`
}

export function getAnalyticsTrendSummary(trend) {
  const { metric, points } = trend

  if (metric.id === 'availability') {
    const average = points.length
      ? points.reduce((total, point) => total + point.value, 0) / points.length
      : 0
    return `Average availability is ${average.toFixed(1)}% across ${points.length} ${points.length === 1 ? 'bucket' : 'buckets'}.`
  }

  const total = points.reduce((sum, point) => sum + point.value, 0)
  return `${formatAnalyticsTrendValue(total, metric)} across ${points.length} ${points.length === 1 ? 'bucket' : 'buckets'}.`
}

export function getDowntimeCauseBreakdown(snapshot) {
  const causes = new Map()

  snapshot.downtimeEvents.forEach((event) => {
    const current = causes.get(event.cause) || {
      cause: event.cause,
      eventCount: 0,
      durationMinutes: 0,
    }
    current.eventCount += 1
    current.durationMinutes += Number(event.durationMinutes || 0)
    causes.set(event.cause, current)
  })

  return [...causes.values()]
    .sort((left, right) => right.durationMinutes - left.durationMinutes || left.cause.localeCompare(right.cause))
}

export function getProcessSensorBreakdown(snapshot) {
  const sensors = new Map()

  snapshot.processEvents.forEach((event) => {
    const current = sensors.get(event.sensorCode) || { sensorCode: event.sensorCode, eventCount: 0 }
    current.eventCount += 1
    sensors.set(event.sensorCode, current)
  })

  return [...sensors.values()].sort((left, right) => left.sensorCode.localeCompare(right.sensorCode))
}

export function formatCompactDuration(minutes) {
  const numMinutes = Number(minutes) || 0
  if (numMinutes < 60) return `${numMinutes}m`
  const hours = Math.floor(numMinutes / 60)
  const remaining = numMinutes % 60
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`
}

export function getTrendEvaluation(trend) {
  const { metric, points } = trend
  if (!points || points.length < 2) {
    return {
      direction: 'flat',
      delta: 0,
      deltaPercent: 0,
      strokeColor: 'var(--chart-current)',
      sentiment: 'neutral',
      label: 'Steady pace',
    }
  }

  // Trim leading zeros so ranges that start before records began don't skew the initial baseline,
  // but preserve trailing and intermediate drops so slowdowns and stoppages reflect accurately.
  let activePoints = points
  if (metric.id === 'downtime' || metric.id === 'production' || metric.id === 'process-events') {
    const firstActiveIndex = points.findIndex((p) => Number(p.value) > 0)
    if (firstActiveIndex > 0) {
      activePoints = points.slice(firstActiveIndex)
    } else if (firstActiveIndex === -1) {
      return {
        direction: 'flat',
        delta: 0,
        deltaPercent: 0,
        strokeColor: 'var(--chart-current)',
        sentiment: 'neutral',
        label: 'Steady pace',
      }
    }
  } else if (metric.id === 'availability') {
    const firstActiveIndex = points.findIndex((p) => Number(p.value) < 100 || (p.downtimeMinutes && p.downtimeMinutes > 0))
    if (firstActiveIndex > 0) {
      activePoints = points.slice(firstActiveIndex)
    }
  }

  if (activePoints.length < 2) {
    return {
      direction: 'flat',
      delta: 0,
      deltaPercent: 0,
      strokeColor: 'var(--chart-current)',
      sentiment: 'neutral',
      label: 'Steady pace',
    }
  }

  // Linear regression slope over activePoints
  const n = activePoints.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0

  for (let i = 0; i < n; i++) {
    const x = i
    const y = Number(activePoints[i].value) || 0
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }

  const meanX = sumX / n
  const meanY = sumY / n
  const denominator = sumX2 - sumX * meanX

  let slope = 0
  if (Math.abs(denominator) > 0.0001) {
    slope = (sumXY - sumX * meanY) / denominator
  }

  const delta = slope * (n - 1)
  const deltaPercent = meanY !== 0 ? (delta / Math.abs(meanY)) * 100 : 0
  const isIncreasing = delta > 0.001
  const isDecreasing = delta < -0.001

  let sentiment = 'neutral'
  let strokeColor = 'var(--chart-current)'

  if (metric.id === 'downtime') {
    // For downtime: increase is red/danger, decrease is green/target
    if (isIncreasing) {
      sentiment = 'negative'
      strokeColor = 'var(--chart-danger)'
    } else if (isDecreasing) {
      sentiment = 'positive'
      strokeColor = 'var(--chart-target)'
    }
  } else if (metric.id === 'production' || metric.id === 'availability') {
    // For actual pieces & availability: increase is green/target, decrease is red/danger
    if (isIncreasing) {
      sentiment = 'positive'
      strokeColor = 'var(--chart-target)'
    } else if (isDecreasing) {
      sentiment = 'negative'
      strokeColor = 'var(--chart-danger)'
    }
  } else {
    sentiment = isIncreasing ? 'neutral-up' : isDecreasing ? 'neutral-down' : 'neutral'
    strokeColor = 'var(--chart-current)'
  }

  const sign = delta > 0 ? '+' : ''
  const percentText = Math.abs(deltaPercent).toFixed(1)

  return {
    direction: isIncreasing ? 'up' : isDecreasing ? 'down' : 'flat',
    delta,
    deltaPercent,
    strokeColor,
    sentiment,
    label: isIncreasing
      ? `Trending up (${sign}${percentText}%)`
      : isDecreasing
        ? `Trending down (${sign}${percentText}%)`
        : 'Steady pace',
  }
}

export function formatAnalyticsDateTime(value, timeZone = 'Asia/Manila') {
  if (!value) return 'Not recorded'

  return new Intl.DateTimeFormat('en-PH', {
    timeZone,
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
