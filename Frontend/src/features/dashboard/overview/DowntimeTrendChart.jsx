import { AlertTriangle } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'

export const trendModes = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Month' },
]

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date) {
  const nextDate = startOfDay(date)
  const day = nextDate.getDay() || 7
  nextDate.setDate(nextDate.getDate() - day + 1)
  return nextDate
}

function addDays(date, days) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

export function toDateInputValue(date) {
  return date.toISOString().slice(0, 10)
}

export function toMonthInputValue(date) {
  return date.toISOString().slice(0, 7)
}

export function fromDateInputValue(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function fromMonthInputValue(value) {
  const [year, month] = value.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

function formatDate(date) {
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
}

function formatMonth(date) {
  return date.toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
  })
}

function formatDowntimeDuration(minutes) {
  if (minutes < 60) {
    return `${minutes} min down`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min down` : `${hours} hr down`
}

export function getTrendRangeLabel(mode, anchorDate) {
  if (mode === 'today') {
    return formatDate(anchorDate)
  }

  if (mode === 'week') {
    const start = startOfWeek(anchorDate)
    return `${formatDate(start)} - ${formatDate(addDays(start, 6))}`
  }

  return formatMonth(anchorDate)
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null
  }

  return (
    <div className="recharts-tooltip-card">
      <strong>{label}</strong>
      <span>{formatDowntimeDuration(payload[0].value)}</span>
      <span>Estimated loss: {payload[0].payload.estimatedLoss} pcs</span>
      <span>Likely cause: {payload[0].payload.cause}</span>
    </div>
  )
}

function HighDowntimeMarker(props) {
  const { cx, cy, payload, thresholdMinutes } = props

  if (!payload || payload.minutes < thresholdMinutes) {
    return null
  }

  return (
    <g transform={`translate(${cx - 8}, ${cy - 8})`}>
      <circle className="downtime-marker-ring" cx="8" cy="8" r="8" />
      <circle className="downtime-marker-dot" cx="8" cy="8" r="4" />
    </g>
  )
}

export default function DowntimeTrendChart({ data, thresholdMinutes = 30 }) {
  return (
    <div className="trend-chart-panel" role="img" aria-label="Downtime trend chart in minutes">
      <ResponsiveContainer width="100%" height={260} minWidth={0}>
        <AreaChart data={data} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="downtimeAreaGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#59CDE9" stopOpacity={0.34} />
              <stop offset="100%" stopColor="#59CDE9" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} tickFormatter={(value) => `${value}m`} width={48} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#59CDE9', strokeOpacity: 0.32 }} />
          {/* Anything above this line gets a red marker so downtime issues are easy to spot. */}
          <ReferenceLine y={thresholdMinutes} stroke="#EF4444" strokeDasharray="6 6" label={{ value: 'Downtime limit', fill: 'var(--status-downtime-text)', fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="minutes"
            stroke="#59CDE9"
            strokeWidth={3}
            fill="url(#downtimeAreaGradient)"
            dot={{ r: 4, strokeWidth: 2, stroke: '#59CDE9', fill: 'var(--c-surface)' }}
            activeDot={{ r: 6, strokeWidth: 3, stroke: '#59CDE9', fill: 'var(--c-surface)' }}
          />
          <Scatter data={data} dataKey="minutes" shape={(props) => <HighDowntimeMarker {...props} thresholdMinutes={thresholdMinutes} />} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="downtime-threshold-note">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>Red markers indicate downtime points above {thresholdMinutes} minutes.</span>
      </div>
      <div className="trend-data-row" aria-hidden="true">
        {data.slice(-4).map((item) => (
          <span key={item.label}>{item.label}: {item.minutes}m</span>
        ))}
      </div>
    </div>
  )
}
