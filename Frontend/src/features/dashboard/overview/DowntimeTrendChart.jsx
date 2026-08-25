import { AlertTriangle } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export const trendModes = [
  { id: 'hour', label: 'Last Hour', disabled: true },
  { id: 'today', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
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
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toMonthInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
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

function formatDowntimeDuration(minutes, periodState) {
  if (periodState === 'future') {
    return 'Period not reached yet'
  }

  if (minutes < 60) {
    return `${minutes} min down${periodState === 'current' ? ' so far' : ''}`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  const duration = remainingMinutes ? `${hours} hr ${remainingMinutes} min down` : `${hours} hr down`
  return periodState === 'current' ? `${duration} so far` : duration
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

  const point = payload[0].payload

  return (
    <div className="recharts-tooltip-card">
      <strong>{label}</strong>
      <span>{formatDowntimeDuration(payload[0].value, point.periodState)}</span>
      {point.periodState !== 'future' ? (
        <>
          <span>Estimated loss: {point.estimatedLoss} pcs</span>
          <span>Likely cause: {point.cause}</span>
        </>
      ) : null}
    </div>
  )
}

export default function DowntimeTrendChart({ data, thresholdMinutes = 30 }) {
  const observedPeriods = data.filter((item) => item.periodState !== 'future')
  const futurePeriodCount = data.length - observedPeriods.length

  return (
    <div className="trend-chart-panel">
      <div role="img" aria-label="Downtime by non-overlapping period bar chart in minutes">
        <ResponsiveContainer width="100%" height={260} minWidth={0}>
          <BarChart data={data} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-text-2)', fontSize: 12 }} tickFormatter={(value) => `${value}m`} width={48} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--hover-bg)' }} />
            <ReferenceLine y={thresholdMinutes} stroke="var(--chart-danger)" strokeDasharray="6 6" label={{ value: `${thresholdMinutes} min limit`, fill: 'var(--status-downtime-text)', fontSize: 11 }} />
            <Bar dataKey="minutes" name="Downtime" radius={[5, 5, 0, 0]} maxBarSize={44}>
              {data.map((item) => (
                <Cell key={item.label} fill={item.minutes >= thresholdMinutes ? 'var(--chart-danger)' : 'var(--chart-warning)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="downtime-threshold-note">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>Red bars indicate periods at or above {thresholdMinutes} minutes.</span>
      </div>
      <div className="trend-data-row" role="list" aria-label="Observed downtime period summary">
        {observedPeriods.slice(-4).map((item) => (
          <span key={item.label} role="listitem">
            {item.label}: {item.minutes}m{item.periodState === 'current' ? ' so far' : ''}
          </span>
        ))}
        {futurePeriodCount > 0 ? (
          <span role="listitem">{futurePeriodCount} future {futurePeriodCount === 1 ? 'period' : 'periods'} not reached</span>
        ) : null}
      </div>
    </div>
  )
}
