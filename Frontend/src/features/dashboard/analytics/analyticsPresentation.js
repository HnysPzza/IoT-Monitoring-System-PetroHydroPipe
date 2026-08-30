import { formatNumber } from '../../../shared/utils/formatters.js'

export const analyticsTrendMetrics = [
  { id: 'downtime', label: 'Downtime', unit: 'minutes', shortUnit: 'min', metricKey: 'downtimeMinutes', description: 'Recorded downtime in each server-generated time bucket.' },
  { id: 'production', label: 'Output', unit: 'pieces', shortUnit: 'pcs', metricKey: 'outputPieces', description: 'Production output pulses in each server-generated time bucket.' },
  { id: 'availability', label: 'Availability', unit: 'percent', shortUnit: '%', metricKey: 'availabilityPercent', description: 'Availability from the operational schedule and recorded downtime.' },
  { id: 'process-events', label: 'Process events', unit: 'events', shortUnit: 'events', metricKey: 'processEventCount', description: 'S-01, S-02, and S-04 pulse events in each server-generated time bucket.' },
  { id: 'estimated-loss', label: 'Estimated loss', unit: 'pieces', shortUnit: 'pcs', metricKey: 'estimatedLossPieces', description: 'Estimated loss at the configured basis of 2.3 pcs per downtime minute.' },
]

export function getAnalyticsTrendMetric(metricId) {
  return analyticsTrendMetrics.find((metric) => metric.id === metricId) || analyticsTrendMetrics[0]
}

function formatMetricValue(value, unit) {
  if (value === null || value === undefined) return '—'
  if (unit === 'percent') return `${Number(value).toFixed(1)}%`
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}

export function getAnalyticsKpis(snapshot) {
  const summary = snapshot.selected.summary
  const eventCount = summary.downtimeEventCount
  const downtimeEventHelper = eventCount === null || eventCount === undefined
    ? 'Event count not observed'
    : `${formatNumber(eventCount)} recorded event${eventCount === 1 ? '' : 's'}`

  return [
    { id: 'downtime', label: 'Downtime', value: formatMetricValue(summary.downtimeMinutes, 'min'), helper: downtimeEventHelper },
    { id: 'availability', label: 'Availability', value: formatMetricValue(summary.availabilityPercent, 'percent'), helper: 'Server-calculated operational availability' },
    { id: 'production', label: 'Output', value: formatMetricValue(summary.outputPieces, 'pcs'), helper: 'Recorded S-05 output pulses' },
    { id: 'process-events', label: 'Process events', value: formatMetricValue(summary.processEventCount, ''), helper: 'Recorded S-01, S-02, and S-04 pulses' },
    { id: 'estimated-loss', label: 'Estimated loss', value: formatMetricValue(summary.estimatedLossPieces, 'pcs'), helper: 'Estimate based on 2.3 pcs per downtime minute' },
  ]
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
      label: isCalendarSegmentComparison ? `Segment ${index + 1}` : selectedPoint?.label || comparisonPoint?.label,
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
  }
}

export function formatAnalyticsTrendValue(value, metric) {
  if (value === null || value === undefined) return 'Not observed'
  if (metric.unit === 'percent') return `${Number(value).toFixed(1)}%`
  return `${formatNumber(value)} ${metric.shortUnit}`
}

export function getAnalyticsTrendSummary(trend) {
  const { metric, points, selectedSummaryValue } = trend
  if (selectedSummaryValue === null || selectedSummaryValue === undefined) {
    return `No observed ${metric.label.toLowerCase()} value is available for this range.`
  }
  if (metric.id === 'availability') {
    return `Availability is ${formatAnalyticsTrendValue(selectedSummaryValue, metric)} for the observed portion of this range.`
  }
  const selectedPoints = points.filter((point) => point.hasSelectedSegment !== false)
  const observedBucketCount = selectedPoints.filter((point) => point.value !== null && point.value !== undefined).length
  const unobservedBucketCount = selectedPoints.length - observedBucketCount
  const observedSummary = `${formatAnalyticsTrendValue(selectedSummaryValue, metric)} across ${observedBucketCount} observed ${observedBucketCount === 1 ? 'bucket' : 'buckets'}`

  if (unobservedBucketCount === 0) return `${observedSummary}.`
  return `${observedSummary}; ${unobservedBucketCount} ${unobservedBucketCount === 1 ? 'bucket is' : 'buckets are'} unobserved.`
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

  const count = activePoints.length
  const sumY = activePoints.reduce((total, point) => total + Number(point.value), 0)
  const sumXY = activePoints.reduce((total, point, index) => total + (index * Number(point.value)), 0)
  const sumX = (count * (count - 1)) / 2
  const sumX2 = ((count - 1) * count * ((2 * count) - 1)) / 6
  const denominator = sumX2 - ((sumX * sumX) / count)
  const slope = denominator ? (sumXY - ((sumX * sumY) / count)) / denominator : 0
  const delta = slope * (count - 1)
  const mean = sumY / count
  const deltaPercent = mean ? (delta / Math.abs(mean)) * 100 : 0
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
