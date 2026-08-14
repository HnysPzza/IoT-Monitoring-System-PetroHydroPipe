import { BarChart3 } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  analyticsTrendMetrics,
  buildAnalyticsTrend,
  formatAnalyticsTrendValue,
  getAnalyticsTrendSummary,
} from './analyticsPresentation.js'

function AnalyticsTrendTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null

  return (
    <div className="recharts-tooltip-card">
      <strong>{label}</strong>
      <span>{metric.label}: {formatAnalyticsTrendValue(payload[0].value, metric)}</span>
    </div>
  )
}

export default function AnalyticsTrendExplorer({ snapshot, metricId, onMetricChange }) {
  const trend = buildAnalyticsTrend(snapshot, metricId)
  const { metric, points, bucket, usesDailyProductionFallback } = trend
  const summary = getAnalyticsTrendSummary(trend)

  return (
    <section className="section-card analytics-trend-card industrial-chart-card" aria-labelledby="analytics-trend-title">
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">Trend explorer</p>
          <h2 id="analytics-trend-title">Operational trend</h2>
        </div>
        <label className="filter-field analytics-metric-field" htmlFor="analytics-trend-metric">
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

      <div className="analytics-trend-context">
        <span className="section-chip">
          <BarChart3 size={16} aria-hidden="true" />
          {metric.label} - {bucket} buckets
        </span>
        <p>
          {usesDailyProductionFallback
            ? 'Production records are date-only, so actual pieces stay in daily buckets until timestamps are available.'
            : metric.description}
        </p>
      </div>

      <div
        className="analytics-trend-chart"
        role="img"
        aria-label={`${metric.label} trend chart from ${snapshot.range.startDate} to ${snapshot.range.endDate}`}
      >
        <ResponsiveContainer width="100%" height={300} minWidth={0}>
          <LineChart data={points} margin={{ top: 14, right: 20, left: 2, bottom: 4 }}>
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
              cursor={{ stroke: 'var(--chart-current)', strokeOpacity: 0.28 }}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={metric.label}
              stroke="var(--chart-current)"
              strokeWidth={3}
              dot={{ r: 3.5, strokeWidth: 2, fill: 'var(--c-surface)' }}
              activeDot={{ r: 6, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="analytics-trend-summary" aria-live="polite">{summary}</p>

      <details className="analytics-chart-details">
        <summary>View {metric.label.toLowerCase()} trend data</summary>
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
