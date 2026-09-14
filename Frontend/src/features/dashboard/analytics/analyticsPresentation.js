import { formatNumber } from '../../../shared/utils/formatters.js'

export const analyticsTrendMetrics = [
  { id: 'downtime', label: 'Downtime', unit: 'minutes', shortUnit: 'min', metricKey: 'downtimeMinutes', description: 'Recorded downtime in each server-generated time bucket.' },
  { id: 'production', label: 'Output', unit: 'pieces', shortUnit: 'pcs', metricKey: 'outputPieces', description: 'Production output pulses in each server-generated time bucket.' },
  { id: 'availability', label: 'Availability', unit: 'percent', shortUnit: '%', metricKey: 'availabilityPercent', description: 'Availability from the operational schedule and recorded downtime.' },
  { id: 'process-events', label: 'Process events', unit: 'events', shortUnit: 'events', metricKey: 'processEventCount', description: 'S-01, S-02, and S-04 pulse events in each server-generated time bucket.' },
  { id: 'estimated-loss', label: 'Estimated loss', unit: 'pieces', shortUnit: 'pcs', metricKey: 'estimatedLossPieces', description: 'Estimated output during unplanned downtime using the current server-calculated production rate.' },
]

export const primaryAnalyticsKpiIds = ['downtime', 'production', 'estimated-loss']
export const secondaryAnalyticsKpiIds = ['availability', 'process-events']

export function getAnalyticsTrendMetric(metricId) {
  return analyticsTrendMetrics.find((metric) => metric.id === metricId) || analyticsTrendMetrics[0]
}

function formatMetricValue(value, unit) {
  if (value === null || value === undefined) return '—'
  if (unit === 'percent') return `${Math.round(Number(value))}%`
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}

function roundDeltaPercent(value) {
  return Number(value.toFixed(1))
}

function getDeltaSentiment(metricId, direction) {
  if (metricId === 'process-events' || direction === 'flat' || direction === 'unknown') return 'neutral'
  const favorableDirection = ['availability', 'production'].includes(metricId) ? 'up' : 'down'
  return direction === favorableDirection ? 'positive' : 'negative'
}

export function getAnalyticsKpiDelta(metricId, selectedSummary, comparisonSummary) {
  if (!comparisonSummary) {
    return { delta: null, deltaPercent: null, direction: 'unknown', sentiment: 'neutral', label: 'No prior period' }
  }

  const metric = getAnalyticsTrendMetric(metricId)
  const currentValue = selectedSummary?.[metric.metricKey]
  const priorValue = comparisonSummary[metric.metricKey]
  if (currentValue === null || currentValue === undefined || priorValue === null || priorValue === undefined) {
    return { delta: null, deltaPercent: null, direction: 'unknown', sentiment: 'neutral', label: 'Not observed' }
  }

  const delta = Number(currentValue) - Number(priorValue)
  const direction = delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : 'flat'
  if (Number(priorValue) === 0) {
    if (direction === 'flat') return { delta, deltaPercent: 0, direction, sentiment: getDeltaSentiment(metricId, direction), label: '0.0%' }
    return { delta, deltaPercent: null, direction, sentiment: getDeltaSentiment(metricId, direction), label: 'No baseline' }
  }

  const deltaPercent = roundDeltaPercent((delta / Math.abs(Number(priorValue))) * 100)
  const sign = deltaPercent > 0 ? '+' : ''
  return {
    delta,
    deltaPercent,
    direction,
    sentiment: getDeltaSentiment(metricId, direction),
    label: `${sign}${deltaPercent.toFixed(1)}%`,
  }
}

export function getAnalyticsKpis(snapshot) {
  const summary = snapshot.selected.summary
  const comparisonSummary = snapshot.comparison?.summary
  const eventCount = summary.downtimeEventCount
  const downtimeEventHelper = eventCount === null || eventCount === undefined
    ? 'Event count not observed'
    : `${formatNumber(eventCount)} recorded event${eventCount === 1 ? '' : 's'}`
  const lossBasis = snapshot.lossEstimateBasis
  const lossBasisLabel = lossBasis.source === 'trailing-7-days'
    ? 'Last 7 completed days'
    : lossBasis.source === 'trailing-30-days'
      ? 'Last 30 completed days'
      : 'Configured fallback'

  const definitions = [
    { id: 'downtime', label: 'Downtime', value: formatMetricValue(summary.downtimeMinutes, 'min'), helper: downtimeEventHelper },
    { id: 'production', label: 'Output', value: formatMetricValue(summary.outputPieces, 'pcs'), helper: 'Recorded S-05 output pulses' },
    { id: 'estimated-loss', label: 'Estimated loss', value: formatMetricValue(summary.estimatedLossPieces, 'pcs'), helper: `${lossBasisLabel}: ${formatNumber(lossBasis.ratePiecesPerMinute)} pcs/min` },
    { id: 'availability', label: 'Availability', value: formatMetricValue(summary.availabilityPercent, 'percent'), helper: 'Server-calculated operational availability' },
    { id: 'process-events', label: 'Process events', value: formatMetricValue(summary.processEventCount, ''), helper: 'Recorded S-01, S-02, and S-04 pulses' },
  ]

  return definitions.map((item) => ({
    ...item,
    delta: getAnalyticsKpiDelta(item.id, summary, comparisonSummary),
    isPrimary: primaryAnalyticsKpiIds.includes(item.id),
    sparkline: (snapshot.selected.trends || []).map((point) => ({
      key: point.key,
      value: point.metrics?.[getAnalyticsTrendMetric(item.id).metricKey] ?? null,
    })),
  }))
}

export function buildAnalyticsTrend(snapshot, metricId = 'downtime') {
  const metric = getAnalyticsTrendMetric(metricId)
  const selectedTrends = snapshot.selected.trends || []
  const comparisonTrends = snapshot.comparison?.trends || []
  const pointCount = Math.max(selectedTrends.length, comparisonTrends.length)
  const isCalendarSegmentComparison = snapshot.trendAlignment?.mode === 'ordinal-calendar-segments'
  const points = Array.from({ length: pointCount }, (_, index) => {
    const selectedPoint = selectedTrends[index]
    const comparisonPoint = comparisonTrends[index]
    return {
      ...(selectedPoint || {}),
      key: selectedPoint?.key || `comparison-only-${comparisonPoint?.key || index}`,
      label: selectedPoint?.label || comparisonPoint?.label,
      selectedLabel: selectedPoint?.label || 'No selected segment',
      comparisonLabel: comparisonPoint?.label || 'No prior segment',
      hasSelectedSegment: Boolean(selectedPoint),
      hasComparisonSegment: Boolean(comparisonPoint),
      value: selectedPoint?.metrics?.[metric.metricKey] ?? null,
      comparisonValue: comparisonPoint?.metrics?.[metric.metricKey] ?? null,
    }
  })

  return {
    metric,
    points,
    bucket: snapshot.selected.range.bucket,
    selectedSummaryValue: snapshot.selected.summary?.[metric.metricKey] ?? null,
    alignment: snapshot.trendAlignment,
    isCalendarSegmentComparison,
  }
}

export function formatAnalyticsTrendValue(value, metric) {
  if (value === null || value === undefined) return 'Not observed'
  if (metric.unit === 'percent') return `${Math.round(Number(value))}%`
  return `${formatNumber(value)} ${metric.shortUnit}`
}

export function getVisibleAnalyticsTrendPoints(points) {
  return points.filter((point) => point.hasSelectedSegment === false || point.periodState !== 'future')
}

export function getAnalyticsTrendSummary(trend) {
  const { metric, points, selectedSummaryValue } = trend
  const selectedPoints = points.filter((point) => point.hasSelectedSegment !== false)
  const observedBucketCount = selectedPoints.filter((point) => point.periodState !== 'future' && point.value !== null && point.value !== undefined).length
  const unobservedBucketCount = selectedPoints.filter((point) => (
    point.periodState !== 'future' && (point.value === null || point.value === undefined)
  )).length
  const stateSuffix = unobservedBucketCount > 0
    ? `; ${unobservedBucketCount} ${unobservedBucketCount === 1 ? 'bucket is' : 'buckets are'} unobserved`
    : ''

  if (selectedSummaryValue === null || selectedSummaryValue === undefined) {
    return `No observed ${metric.label.toLowerCase()} value is available for this range${stateSuffix}.`
  }
  if (metric.id === 'availability') {
    return `Availability is ${formatAnalyticsTrendValue(selectedSummaryValue, metric)} for the observed portion of this range${stateSuffix}.`
  }
  const observedSummary = `${formatAnalyticsTrendValue(selectedSummaryValue, metric)} across ${observedBucketCount} observed ${observedBucketCount === 1 ? 'bucket' : 'buckets'}`

  return `${observedSummary}${stateSuffix}.`
}

export function getDowntimeSensorBreakdown(snapshot) {
  return snapshot.selected.downtimeSensors || []
}

export function getDowntimeCauseBreakdown(snapshot) {
  return snapshot.selected.downtimeCauses || []
}

export function getProcessSensorBreakdown(snapshot) {
  return snapshot.selected.processSensors || []
}

export function formatCompactDuration(minutes) {
  const numMinutes = Number(minutes) || 0
  if (numMinutes < 60) return `${numMinutes}m`
  const hours = Math.floor(numMinutes / 60)
  const remaining = numMinutes % 60
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`
}

function neutralEvaluation(label = 'Steady pace') {
  return { direction: 'flat', delta: 0, deltaPercent: 0, strokeColor: 'var(--chart-current)', sentiment: 'neutral', label }
}

export function getTrendEvaluation(trend) {
  const observedPoints = (trend.points || []).filter((point) => point.value !== null && point.value !== undefined)
  if (observedPoints.length === 0) return neutralEvaluation('Not observed')
  if (observedPoints.length === 1) return neutralEvaluation('Insufficient observations')

  let activePoints = observedPoints
  if (['downtime', 'production', 'process-events', 'estimated-loss'].includes(trend.metric.id)) {
    const firstActive = observedPoints.findIndex((point) => Number(point.value) > 0)
    if (firstActive === -1) return neutralEvaluation()
    activePoints = observedPoints.slice(firstActive)
  }
  if (activePoints.length < 2) return neutralEvaluation('Insufficient observations')

  const firstValue = Number(activePoints[0].value)
  const lastValue = Number(activePoints.at(-1).value)
  if (firstValue === 0) return neutralEvaluation('No baseline')

  const delta = lastValue - firstValue
  const deltaPercent = (delta / Math.abs(firstValue)) * 100
  const direction = delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : 'flat'
  if (direction === 'flat') return neutralEvaluation()

  const positiveIncrease = ['production', 'availability'].includes(trend.metric.id)
  const positive = positiveIncrease ? direction === 'up' : trend.metric.id === 'downtime' || trend.metric.id === 'estimated-loss' ? direction === 'down' : null
  const sentiment = positive === null ? `neutral-${direction}` : positive ? 'positive' : 'negative'
  const strokeColor = positive === null ? 'var(--chart-current)' : positive ? 'var(--chart-target)' : 'var(--chart-danger)'
  const sign = deltaPercent > 0 ? '+' : ''

  return { direction, delta, deltaPercent, strokeColor, sentiment, label: `Trending ${direction} (${sign}${deltaPercent.toFixed(1)}%)` }
}

export function formatAnalyticsDateTime(value, timeZone = 'Asia/Manila') {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat('en-PH', { timeZone, month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
