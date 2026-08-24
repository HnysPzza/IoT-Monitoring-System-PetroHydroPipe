import { CircleHelp, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../../shared/utils/formatters.js'

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0]?.payload

  return (
    <div className="recharts-tooltip-card industrial-tooltip">
      <strong>{label} {point?.shift ? `- ${point.shift}` : ''}</strong>
      {payload.map((item) => (
        <span key={item.dataKey} style={{ color: item.color }}>
          {item.name}: {formatNumber(item.value)} {unit}
        </span>
      ))}
    </div>
  )
}

export default function ProductionAnalytics({ analytics }) {
  const selected = analytics.day
  const difference = selected.difference ?? (selected.currentTotal - selected.previousTotal)
  const hasBaseline = selected.previousTotal > 0 && selected.differencePercent !== null
  const isPositive = difference > 0
  const isNegative = difference < 0
  const comparisonClass = isPositive ? 'is-positive' : isNegative ? 'is-negative' : 'is-neutral'
  let comparisonLabel = 'No change'
  let insight = `${selected.currentLabel} matches ${selected.previousLabel.toLowerCase()} at ${formatNumber(selected.currentTotal)} ${selected.unit}.`
  let InsightIcon = Minus

  if (!hasBaseline) {
    comparisonLabel = 'No baseline'
    insight = selected.currentTotal > 0
      ? `${selected.currentLabel} recorded ${formatNumber(selected.currentTotal)} ${selected.unit}; ${selected.previousLabel.toLowerCase()} recorded none.`
      : `No output was recorded ${selected.currentLabel.toLowerCase()} or ${selected.previousLabel.toLowerCase()}.`
    InsightIcon = selected.currentTotal > 0 ? CircleHelp : Minus
  } else if (isPositive) {
    comparisonLabel = `+${Math.abs(selected.differencePercent).toFixed(1)}%`
    insight = `${selected.currentLabel} is ${Math.abs(selected.differencePercent).toFixed(1)}% above ${selected.previousLabel.toLowerCase()}.`
    InsightIcon = TrendingUp
  } else if (isNegative) {
    comparisonLabel = `-${Math.abs(selected.differencePercent).toFixed(1)}%`
    insight = `${selected.currentLabel} is ${Math.abs(selected.differencePercent).toFixed(1)}% below ${selected.previousLabel.toLowerCase()}.`
    InsightIcon = TrendingDown
  }

  return (
    <section className="section-card production-analytics-card industrial-chart-card" aria-labelledby="production-analytics-title">
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">Data analytics</p>
          <h2 id="production-analytics-title">{selected.label}</h2>
        </div>
      </div>

      <div className="analytics-summary-row industrial-kpi-strip">
        <div>
          <span className="live-metric-label">{selected.currentLabel}</span>
          <strong>{formatNumber(selected.currentTotal)} {selected.unit}</strong>
        </div>
        <div>
          <span className="live-metric-label">{selected.previousLabel}</span>
          <strong>{formatNumber(selected.previousTotal)} {selected.unit}</strong>
        </div>
        <div>
          <span className="live-metric-label">Difference</span>
          <strong>{difference > 0 ? '+' : ''}{formatNumber(difference)} {selected.unit}</strong>
        </div>
        <div className={`analytics-delta ${comparisonClass}`}>
          <InsightIcon size={18} aria-hidden="true" />
          <span>{comparisonLabel}</span>
        </div>
      </div>

      <div className="analytics-chart industrial-recharts-panel" aria-label={`${selected.label} production output comparison chart`}>
        <div className="chart-legend" aria-label="Production chart legend">
          <span><i className="legend-line legend-current" aria-hidden="true" />{selected.currentLabel}</span>
          <span><i className="legend-line legend-previous" aria-hidden="true" />{selected.previousLabel}</span>
        </div>
        <ResponsiveContainer width="100%" height={320} minWidth={0}>
          {/* ComposedChart layers cumulative output for today and yesterday in one view. */}
          <ComposedChart data={selected.points} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="productionCurrentArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-current)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-current)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="2 8" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} tickFormatter={formatNumber} width={58} />
            <Tooltip content={<ChartTooltip unit={selected.unit} />} cursor={{ stroke: 'var(--chart-current)', strokeOpacity: 0.24 }} />
            <Area type="monotone" dataKey="current" name={selected.currentLabel} fill="url(#productionCurrentArea)" stroke="var(--chart-current)" strokeWidth={3.5} dot={{ r: 4, strokeWidth: 2, fill: 'var(--c-surface)' }} activeDot={{ r: 7, strokeWidth: 3 }} />
            <Line type="monotone" dataKey="previous" name={selected.previousLabel} stroke="var(--chart-previous)" strokeWidth={2.5} strokeDasharray="7 7" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className={`analytics-insight ${isPositive && hasBaseline ? 'is-positive' : isNegative ? 'is-warning' : 'is-neutral'}`}>
        <InsightIcon size={16} aria-hidden="true" />
        <span>{insight}</span>
      </div>
    </section>
  )
}
