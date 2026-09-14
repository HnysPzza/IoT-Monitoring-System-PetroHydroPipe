import { Minus, TrendingDown, TrendingUp } from 'lucide-react'

function getSparklineValues(points) {
  return (points || [])
    .map((point) => (typeof point === 'number' ? point : point?.value))
    .map((value) => (value === null || value === undefined ? null : Number(value)))
    .filter((value) => Number.isFinite(value))
}

function getSparklinePath(points) {
  const values = getSparklineValues(points)
  if (values.length === 0) return null
  const chartValues = values.length === 1 ? [values[0], values[0]] : values

  const minimum = Math.min(...chartValues)
  const maximum = Math.max(...chartValues)
  const span = maximum - minimum || 1
  const coordinates = chartValues.map((value, index) => {
    const x = chartValues.length === 1 ? 0 : (index / (chartValues.length - 1)) * 100
    const y = 30 - ((value - minimum) / span) * 24
    return [x, y]
  })
  const line = coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const area = `${line} L 100 32 L 0 32 Z`
  return { line, area }
}

function DeltaIcon({ direction }) {
  if (direction === 'up') return <TrendingUp size={13} aria-hidden="true" />
  if (direction === 'down') return <TrendingDown size={13} aria-hidden="true" />
  return <Minus size={13} aria-hidden="true" />
}

export default function AnalyticsKpiCard({ kpi, selectedMetric, onSelect }) {
  const isSelected = selectedMetric === kpi.id
  const delta = kpi.delta || { direction: 'unknown', sentiment: 'neutral', label: 'No prior period' }
  const sparkline = kpi.isPrimary ? getSparklinePath(kpi.sparkline) : null

  return (
    <button
      className={`section-card analytics-kpi-card ${kpi.isPrimary ? 'analytics-primary-kpi-card' : 'analytics-secondary-kpi-card'} ${isSelected ? 'is-selected' : ''}`}
      type="button"
      aria-pressed={isSelected}
      onClick={() => onSelect(kpi.id)}
    >
      <div className="analytics-kpi-heading">
        <span className="stat-label">{kpi.label}</span>
      </div>
      <div className="analytics-kpi-value-row">
        <p className="stat-value">{kpi.value}</p>
        <span className={`analytics-kpi-delta is-${delta.sentiment}`}>
          <DeltaIcon direction={delta.direction} />
          <span>{delta.label}</span>
          <span className="sr-only"> compared with the prior period</span>
        </span>
      </div>
      <p className="stat-helper">{kpi.helper}</p>
      {sparkline ? (
        <div className="analytics-kpi-sparkline" data-testid="analytics-kpi-sparkline" aria-hidden="true">
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" focusable="false">
            <path className="analytics-kpi-sparkline-area" d={sparkline.area} />
            <path className="analytics-kpi-sparkline-line" d={sparkline.line} />
          </svg>
        </div>
      ) : null}
    </button>
  )
}
