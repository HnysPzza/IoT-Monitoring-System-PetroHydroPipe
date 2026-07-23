import { Gauge, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '../../../shared/utils/formatters.js'

const analyticsModes = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

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
      <span>Estimated loss: {formatNumber(point?.estimatedLoss || 0)} pcs</span>
    </div>
  )
}

export default function ProductionAnalytics({ analytics, mode, onModeChange }) {
  // selected changes when the user switches Day / Week / Month.
  const selected = analytics[mode]
  const delta = selected.currentTotal - selected.previousTotal
  const deltaPercent = selected.previousTotal ? (delta / selected.previousTotal) * 100 : 0
  const targetGap = selected.currentTotal - selected.targetTotal
  const isPositive = delta >= 0
  const isOnTarget = targetGap >= 0
  const insight = `${selected.currentLabel} is ${Math.abs(deltaPercent).toFixed(1)}% ${isPositive ? 'above' : 'below'} ${selected.previousLabel.toLowerCase()} and ${formatNumber(Math.abs(targetGap))} pcs ${isOnTarget ? 'above' : 'below'} target.`

  return (
    <section className="section-card production-analytics-card industrial-chart-card" aria-labelledby="production-analytics-title">
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">Data analytics</p>
          <h2 id="production-analytics-title">{selected.label}</h2>
        </div>
        <div className="trend-mode-toggle analytics-mode-toggle" role="group" aria-label="Production analytics range">
          {analyticsModes.map((item) => (
            <button
              key={item.id}
              className={`trend-mode-button ${mode === item.id ? 'is-selected' : ''}`}
              type="button"
              aria-pressed={mode === item.id}
              onClick={() => onModeChange(item.id)}
            >
              {item.label}
            </button>
          ))}
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
          <span className="live-metric-label">Target Output</span>
          <strong>{formatNumber(selected.targetTotal)} {selected.unit}</strong>
        </div>
        <div className={isPositive ? 'analytics-delta is-positive' : 'analytics-delta is-negative'}>
          {isPositive ? <TrendingUp size={18} aria-hidden="true" /> : <TrendingDown size={18} aria-hidden="true" />}
          <span>{isPositive ? '+' : ''}{deltaPercent.toFixed(1)}%</span>
        </div>
      </div>

      <div className="analytics-chart industrial-recharts-panel" aria-label={`${selected.label} production output comparison chart`}>
        <div className="chart-legend" aria-label="Production chart legend">
          <span><i className="legend-line legend-current" aria-hidden="true" />{selected.currentLabel}</span>
          <span><i className="legend-line legend-previous" aria-hidden="true" />{selected.previousLabel}</span>
          <span><i className="legend-line legend-target" aria-hidden="true" />Target pace</span>
        </div>
        <ResponsiveContainer width="100%" height={320} minWidth={0}>
          {/* ComposedChart layers current output, previous output, and target pace in one view. */}
          <ComposedChart data={selected.points} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="productionCurrentArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#59CDE9" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#59CDE9" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="2 8" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} tickFormatter={formatNumber} width={58} />
            <Tooltip content={<ChartTooltip unit={selected.unit} />} cursor={{ stroke: '#59CDE9', strokeOpacity: 0.24 }} />
            <Area type="monotone" dataKey="current" name={selected.currentLabel} fill="url(#productionCurrentArea)" stroke="#1677FF" strokeWidth={3.5} dot={{ r: 4, strokeWidth: 2, fill: 'var(--c-surface)' }} activeDot={{ r: 7, strokeWidth: 3 }} />
            <Line type="monotone" dataKey="previous" name={selected.previousLabel} stroke="#B0BBF7" strokeWidth={2.5} strokeDasharray="7 7" dot={false} />
            <Line type="monotone" dataKey="target" name="Target pace" stroke="#10B981" strokeWidth={2} strokeDasharray="4 6" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className={isOnTarget ? 'analytics-insight is-positive' : 'analytics-insight is-warning'}>
        {isOnTarget ? <Gauge size={16} aria-hidden="true" /> : <Target size={16} aria-hidden="true" />}
        <span>{insight}</span>
      </div>
    </section>
  )
}
