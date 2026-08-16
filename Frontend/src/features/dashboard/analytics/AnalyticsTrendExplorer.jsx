import { useState } from 'react'
import { BarChart3, ChevronDown, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  analyticsTrendMetrics,
  buildAnalyticsTrend,
  formatAnalyticsTrendValue,
  getAnalyticsTrendSummary,
  getTrendEvaluation,
} from './analyticsPresentation.js'

function AnalyticsTrendTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null

  return (
    <div className="recharts-tooltip-card industrial-tooltip">
      <strong>{label}</strong>
      <span>{metric.label}: {formatAnalyticsTrendValue(payload[0].value, metric)}</span>
    </div>
  )
}

export default function AnalyticsTrendExplorer({ snapshot, metricId, onMetricChange }) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const trend = buildAnalyticsTrend(snapshot, metricId)
  const { metric, points, bucket, usesDailyProductionFallback } = trend
  const summary = getAnalyticsTrendSummary(trend)
  const evaluation = getTrendEvaluation(trend)
  const strokeColor = evaluation.strokeColor

  return (
    <section className="section-card analytics-trend-card industrial-chart-card" aria-labelledby="analytics-trend-title">
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">Trend explorer</p>
          <h2 id="analytics-trend-title">Operational trend</h2>
        </div>

        <div className="analytics-metric-controls">
          <div className="trend-mode-toggle analytics-metric-toggle" role="group" aria-label="Trend metric selection">
            {analyticsTrendMetrics.map((item) => (
              <button
                key={item.id}
                className={`trend-mode-button ${metric.id === item.id ? 'is-selected' : ''}`}
                type="button"
                aria-pressed={metric.id === item.id}
                onClick={() => onMetricChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="filter-field analytics-metric-field sr-only" htmlFor="analytics-trend-metric">
            <span>Trend metric</span>
            <select
              id="analytics-trend-metric"
              value={metric.id}
              onChange={(event) => onMetricChange(event.target.value)}
            >
              {analyticsTrendMetrics.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="analytics-trend-context">
        <span className="section-chip">
          <BarChart3 size={16} aria-hidden="true" />
          {metric.label} - {bucket} buckets
        </span>
        <p>
          {usesDailyProductionFallback
            ? 'Production records are date-only; daily buckets active.'
            : metric.description}
        </p>
      </div>

      <div
        className="analytics-trend-chart"
        role="img"
        aria-label={`${metric.label} trend chart from ${snapshot.range.startDate} to ${snapshot.range.endDate}`}
      >
        <ResponsiveContainer width="100%" height={320} minWidth={0}>
          <AreaChart data={points} margin={{ top: 14, right: 20, left: 2, bottom: 4 }}>
            <defs>
              <linearGradient id="analyticsTrendAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.30} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="3 7" vertical={false} />
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
            />
          </AreaChart>
        </ResponsiveContainer>
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

      <details
        className="analytics-chart-details"
        open={isDetailsOpen}
        onToggle={(event) => setIsDetailsOpen(event.currentTarget.open)}
      >
        <summary>
          <ChevronDown
            size={16}
            className={`analytics-details-chevron ${isDetailsOpen ? 'is-expanded' : ''}`}
            aria-hidden="true"
          />
          <span>View {metric.label.toLowerCase()} trend data</span>
        </summary>
        <div className="account-table-wrap">
          <table className="account-table analytics-chart-table">
            <thead>
              <tr>
                <th scope="col">Bucket</th>
                <th scope="col">{metric.label}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.key}>
                  <td>{point.label}</td>
                  <td>{formatAnalyticsTrendValue(point.value, metric)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
