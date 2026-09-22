const PRIMARY_METRICS = [
  { id: 'production', label: 'Production Count' },
  { id: 'availability', label: 'Availability' },
  { id: 'loss', label: 'Estimated Loss' },
]

function getSummaryItem(summaryById, id, fallbackLabel) {
  return summaryById[id] || {
    id,
    label: fallbackLabel,
    value: 'N/A',
    helper: 'Not observed',
  }
}

function parseSummaryNumber(value) {
  if (value === null || value === undefined || value === 'N/A') return null
  const match = String(value).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function getMetricValue(report, id, summaryItem) {
  const metricKey = id === 'production' ? 'outputPieces' : id === 'availability' ? 'availabilityPercent' : 'estimatedLoss'
  const metricValue = report.metrics?.[metricKey]
  return metricValue === null || metricValue === undefined
    ? parseSummaryNumber(summaryItem.value)
    : Number(metricValue)
}

function getDeltaSentiment(metricId, direction) {
  if (direction === 'flat' || direction === 'unknown') return 'neutral'
  const favorableDirection = metricId === 'loss' ? 'down' : 'up'
  return direction === favorableDirection ? 'positive' : 'negative'
}

export function getReportDelta(metricId, currentValue, previousValue, hasComparison = true) {
  const currentNumber = currentValue === null || currentValue === undefined ? Number.NaN : Number(currentValue)
  const previousNumber = previousValue === null || previousValue === undefined ? Number.NaN : Number(previousValue)
  if (!Number.isFinite(currentNumber)) {
    return { delta: null, deltaPercent: null, direction: 'unknown', sentiment: 'neutral', label: 'Not observed' }
  }
  if (!hasComparison) {
    return { delta: null, deltaPercent: null, direction: 'unknown', sentiment: 'neutral', label: 'No prior period' }
  }
  if (!Number.isFinite(previousNumber)) {
    return { delta: null, deltaPercent: null, direction: 'unknown', sentiment: 'neutral', label: 'Not observed' }
  }

  const delta = currentNumber - previousNumber
  const direction = delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : 'flat'
  const sentiment = getDeltaSentiment(metricId, direction)

  if (metricId === 'availability') {
    const sign = delta > 0 ? '+' : ''
    return {
      delta,
      deltaPercent: null,
      direction,
      sentiment,
      label: `${sign}${delta.toFixed(1)} pp`,
    }
  }

  if (previousNumber === 0) {
    return {
      delta,
      deltaPercent: null,
      direction,
      sentiment: direction === 'flat' ? 'neutral' : 'neutral',
      label: direction === 'flat' ? '0.0%' : 'No baseline',
    }
  }

  const deltaPercent = Number(((delta / Math.abs(previousNumber)) * 100).toFixed(1))
  const sign = deltaPercent > 0 ? '+' : ''
  return {
    delta,
    deltaPercent,
    direction,
    sentiment,
    label: `${sign}${deltaPercent.toFixed(1)}%`,
  }
}

function getDowntimeValue(summaryById) {
  const eventValue = getSummaryItem(summaryById, 'events', 'Downtime Events').value
  const durationValue = getSummaryItem(summaryById, 'duration', 'Downtime Duration').value
  if (eventValue === 'N/A' || durationValue === 'N/A') return 'N/A'

  const events = String(eventValue).replace(/\s+events?$/i, '')
  const duration = String(durationValue).replace(/\s+minutes?$/i, '')
  return `${events} events · ${duration}`
}

export function getReportCards(report = {}) {
  const summaryById = Object.fromEntries((report.summary || []).map((item) => [item.id, item]))
  const comparisonMetrics = report.comparison?.metrics
  const hasComparison = Boolean(report.comparison)

  const primaryCards = PRIMARY_METRICS.map(({ id, label }) => {
    const item = getSummaryItem(summaryById, id, label)
    const currentValue = getMetricValue(report, id, item)
    const previousValue = comparisonMetrics?.[
      id === 'production' ? 'outputPieces' : id === 'availability' ? 'availabilityPercent' : 'estimatedLoss'
    ]

    return {
      ...item,
      id,
      label,
      isPrimary: true,
      isWarning: id === 'loss' && Number.isFinite(currentValue) && currentValue > 0,
      delta: getReportDelta(id, currentValue, previousValue, hasComparison),
    }
  })

  const processEvents = getSummaryItem(summaryById, 'process-events', 'Process Events')

  return [
    ...primaryCards,
    { ...processEvents, id: 'process-events', label: 'Process Events', isPrimary: false },
    {
      id: 'downtime',
      label: 'Downtime',
      value: getDowntimeValue(summaryById),
      helper: 'Events and duration in selected period',
      isPrimary: false,
    },
  ]
}
