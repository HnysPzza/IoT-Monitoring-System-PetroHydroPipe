const PRIMARY_METRICS = [
  { id: 'production', label: 'Production Count' },
  { id: 'availability', label: 'Availability' },
  { id: 'loss', label: 'Estimated Loss' },
]

const PRODUCTION_PRIMARY_METRICS = [
  { id: 'total-output', metricKey: 'totalProductionOutput', label: 'Total Output' },
  { id: 'specified-pipes', metricKey: 'specifiedPipes', label: 'Specified Pipes' },
  { id: 'unspecified-pipes', metricKey: 'unspecifiedPipes', label: 'Unspecified Pipes' },
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
  const favorableDirection = (metricId === 'loss' || metricId === 'unspecified-pipes') ? 'down' : 'up'
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

  const events = String(eventValue).replace(/\s*(?:events?)$/i, '')
  const duration = String(durationValue).replace(/\s*(?:minutes?|mins?)$/i, '')
  const eventLabel = events === '1' ? 'event' : 'events'
  return `${events} ${eventLabel} · ${duration} min`
}

export function getReportCards(report = {}) {
  const summaryById = Object.fromEntries((report.summary || []).map((item) => [item.id, item]))
  const comparisonMetrics = report.comparison?.metrics
  const hasComparison = Boolean(report.comparison)

  if (report.category === 'production') {
    const primaryCards = PRODUCTION_PRIMARY_METRICS.map(({ id, metricKey, label }) => {
      const item = getSummaryItem(summaryById, id, label)
      const currentValue = report.metrics?.[metricKey] ?? parseSummaryNumber(item.value)
      const previousValue = comparisonMetrics?.[metricKey]

      return {
        ...item,
        id,
        label,
        isPrimary: true,
        isWarning: id === 'unspecified-pipes' && Number.isFinite(currentValue) && currentValue > 0,
        delta: getReportDelta(id, currentValue, previousValue, hasComparison),
      }
    })

    const distinctSizesItem = getSummaryItem(summaryById, 'distinct-sizes', 'Distinct Sizes')

    return [
      ...primaryCards,
      {
        ...distinctSizesItem,
        id: 'distinct-sizes',
        label: 'Distinct Sizes',
        isPrimary: false,
      },
    ]
  }

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

  return [
    ...primaryCards,
    {
      id: 'downtime',
      label: 'Downtime',
      value: getDowntimeValue(summaryById),
      helper: 'Open and resolved, unplanned',
      isPrimary: false,
    },
  ]
}
