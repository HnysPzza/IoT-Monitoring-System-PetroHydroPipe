import { BarChart3, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  analyticsTrendMetrics,
  buildAnalyticsTrend,
  formatAnalyticsTrendValue,
  getAnalyticsTrendSummary,
  getTrendEvaluation,
  getVisibleAnalyticsTrendPoints,
} from './analyticsPresentation.js'

function AnalyticsTrendTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null

  return (
    <div className="recharts-tooltip-card industrial-tooltip">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <span key={entry.dataKey}>
          {entry.dataKey === 'comparisonValue'
            ? `Prior period (${entry.payload.comparisonLabel})`
            : `Selected period (${entry.payload.selectedLabel})`}:{' '}
          {formatAnalyticsTrendValue(entry.value, metric)}
        </span>
      ))}
    </div>
  )
}

export default function AnalyticsTrendExplorer({ snapshot, metricId, onMetricChange }) {
  const trend = buildAnalyticsTrend(snapshot, metricId)
  const { metric, points, bucket, isCalendarSegmentComparison } = trend
  const summary = getAnalyticsTrendSummary(trend)
  const evaluation = getTrendEvaluation(trend)
  const strokeColor = evaluation.strokeColor
  const visiblePoints = getVisibleAnalyticsTrendPoints(points)
  const hasTrendData = visiblePoints.some((point) => point.value !== null && point.value !== undefined)
  const hasComparison = snapshot.comparisonMode !== 'none'
  const selectedRange = snapshot.selected.range
  const currentPoint = visiblePoints.find((point) => point.periodState === 'partial')
  const selectedVisiblePointCount = visiblePoints.filter((point) => point.hasSelectedSegment !== false).length
  const visibleEndLabel = visiblePoints.findLast((point) => point.hasSelectedSegment !== false)?.selectedLabel

  return (
    <section className="section-card analytics-trend-card industrial-chart-card" aria-labelledby="analytics-trend-title">
      <div className="section-heading">
        <div>
          <h2 id="analytics-trend-title">Operational trend</h2>
        </div>

        {/* Accessible fallback select for screen readers and automation */}
        <label className="filter-field analytics-metric-field sr-only" htmlFor="analytics-trend-metric">
          <span>Trend metric</span>
          <select
            id="analytics-trend-metric"
            value={metric.id}
            onChange={(event) => onMetricChange?.(event.target.value)}
          >
            {analyticsTrendMetrics.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="analytics-trend-context">
        <span className="section-chip">
          <BarChart3 size={16} aria-hidden="true" />
          {metric.label} - {bucket} buckets
        </span>
        <span className="section-chip">
          <span aria-hidden="true" style={{ width: 18, borderTop: '3px solid var(--chart-current)' }} />
          Selected period
        </span>
        {hasComparison ? (
          <span className="section-chip">
            <span aria-hidden="true" style={{ width: 18, borderTop: '2px dashed var(--chart-previous)' }} />
            Prior period
          </span>
        ) : null}
      </div>

      {isCalendarSegmentComparison ? (
        <p className="analytics-cause-meta">Monthly points align by sequence; hover a point to compare its actual periods.</p>
      ) : null}

      <div
        className="analytics-trend-chart"
        role="img"
        aria-label={`${metric.label} trend chart from ${selectedRange.requestedStartDate}${visibleEndLabel ? ` through ${visibleEndLabel}` : ' with no elapsed buckets'}${hasComparison ? ', compared with the prior period' : ''}`}
      >
        <ResponsiveContainer width="100%" height={320} minWidth={0}>
          <AreaChart data={visiblePoints} margin={{ top: 14, right: 20, left: 2, bottom: 4 }}>
            <defs>
              <linearGradient id="analyticsTrendAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.30} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="3 7" vertical={false} />
            {currentPoint && selectedVisiblePointCount > 1 ? (
              <ReferenceLine
                x={currentPoint.label}
                stroke="var(--c-text-3)"
                strokeDasharray="4 4"
                label={{ value: 'Now', position: 'insideTopRight', fill: 'var(--c-text-3)', fontSize: 11 }}
              />
            ) : null}
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--c-text-2)', fontSize: 12 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--c-text-2)', fontSize: 12 }}
              tickFormatter={(value) => formatAnalyticsTrendValue(value, metric)}
              width={metric.unit === 'percent' ? 52 : 62}
            />
            <Tooltip
              content={<AnalyticsTrendTooltip metric={metric} />}
              cursor={{ stroke: strokeColor, strokeOpacity: 0.28 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={metric.label}
              stroke={strokeColor}
              strokeWidth={3}
              fill="url(#analyticsTrendAreaGradient)"
              dot={{ r: 3.5, strokeWidth: 2, fill: 'var(--c-surface)', stroke: strokeColor }}
              activeDot={{ r: 6, strokeWidth: 2, fill: strokeColor, stroke: 'var(--c-surface)' }}
              isAnimationActive={true}
              animationDuration={600}
              animationEasing="ease-out"
              connectNulls={false}
            />
            {hasComparison ? (
              <Area
                type="monotone"
                dataKey="comparisonValue"
                name={`Prior ${metric.label}`}
                stroke="var(--chart-previous)"
                strokeWidth={2}
                strokeDasharray="7 5"
                fill="transparent"
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, fill: 'var(--chart-previous)', stroke: 'var(--c-surface)' }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
        {!hasTrendData ? (
          <div className="analytics-trend-empty-watermark" aria-hidden="true">
            No data yet
          </div>
        ) : null}
      </div>

      <div className="analytics-trend-summary-row">
        <p className="analytics-trend-summary" aria-live="polite">{summary}</p>
        <div className={`analytics-trend-badge is-${evaluation.sentiment}`}>
          {evaluation.direction === 'up' ? (
            <TrendingUp size={15} aria-hidden="true" />
          ) : evaluation.direction === 'down' ? (
            <TrendingDown size={15} aria-hidden="true" />
          ) : (
            <Minus size={15} aria-hidden="true" />
          )}
          <span>{evaluation.label}</span>
        </div>
      </div>

    </section>
  )
}
