import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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
  const visiblePoints = selected.points.filter((point) => point.periodState !== 'future')
  const currentPoint = visiblePoints.find((point) => point.periodState === 'current')

  return (
    <section className="section-card production-analytics-card industrial-chart-card" aria-labelledby="production-analytics-title">
      <div className="section-heading">
        <div>
          <h2 id="production-analytics-title">{selected.label}</h2>
        </div>
      </div>

      <div className="analytics-chart industrial-recharts-panel" role="img" aria-label={`${selected.label} production output comparison chart`}>
        <div className="chart-legend" aria-label="Production chart legend">
          <span><i className="legend-line legend-current" aria-hidden="true" />Today ({formatNumber(selected.currentTotal)} {selected.unit})</span>
          <span><i className="legend-line legend-previous" aria-hidden="true" />Yesterday ({formatNumber(selected.previousTotal)} {selected.unit})</span>
        </div>
        <ResponsiveContainer width="100%" height={195} minWidth={0}>
          {/* ComposedChart layers cumulative output for today and yesterday in one view. */}
          <ComposedChart data={visiblePoints} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="2 8" vertical={false} />
            {currentPoint && visiblePoints.length > 1 ? (
              <ReferenceLine
                x={currentPoint.label}
                stroke="var(--c-text-3)"
                strokeDasharray="4 4"
                label={{ value: 'Now', position: 'insideTopRight', fill: 'var(--c-text-3)', fontSize: 11 }}
              />
            ) : null}
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} tickFormatter={formatNumber} width={58} />
            <Tooltip content={<ChartTooltip unit={selected.unit} />} cursor={{ stroke: 'var(--chart-current)', strokeOpacity: 0.24 }} />
            <Area type="monotone" dataKey="current" name={selected.currentLabel} fill="transparent" stroke="var(--chart-current)" strokeWidth={3.5} dot={{ r: 4, strokeWidth: 2, fill: 'var(--c-surface)' }} activeDot={{ r: 7, strokeWidth: 3 }} />
            <Line type="monotone" dataKey="previous" name={selected.previousLabel} stroke="var(--chart-previous)" strokeWidth={2.5} strokeDasharray="7 7" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

    </section>
  )
}
