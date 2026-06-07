import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, PauseCircle, TrendingUp, Wifi } from 'lucide-react'
import { overviewMockData } from '../../../shared/data/dashboardMock.js'

const trendModes = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Month' },
]

function startOfDay(date) {
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

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10)
}

function toMonthInputValue(date) {
  return date.toISOString().slice(0, 7)
}

function fromDateInputValue(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function fromMonthInputValue(value) {
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

function seededMinutes(date, index, mode) {
  const seed = date.getFullYear() + date.getMonth() * 17 + date.getDate() * 29 + index * 11
  const base = mode === 'today' ? 8 : mode === 'month' ? 18 : 14
  return Math.max(0, Math.round(base + (seed % 31) - (index % 3) * 4))
}

function getTrendRangeLabel(mode, anchorDate) {
  if (mode === 'today') {
    return formatDate(anchorDate)
  }

  if (mode === 'week') {
    const start = startOfWeek(anchorDate)
    return `${formatDate(start)} - ${formatDate(addDays(start, 6))}`
  }

  return formatMonth(anchorDate)
}

function getTrendData(mode, anchorDate) {
  if (mode === 'today') {
    const labels = ['6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM']
    return labels.map((label, index) => ({
      label,
      minutes: seededMinutes(anchorDate, index, mode),
    }))
  }

  if (mode === 'week') {
    const start = startOfWeek(anchorDate)
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index)
      return {
        label: date.toLocaleDateString('en-PH', { weekday: 'short' }),
        minutes: seededMinutes(date, index, mode),
      }
    })
  }

  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, month, index + 1)
    return {
      label: String(index + 1),
      minutes: seededMinutes(date, index, mode),
    }
  })
}

function DowntimeChart({ data }) {
  const [activePoint, setActivePoint] = useState(null)
  const width = 720
  const height = 280
  const padding = { top: 18, right: 18, bottom: 42, left: 44 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const maxMinutes = Math.max(...data.map((item) => item.minutes), 10)
  const points = data.map((item, index) => {
    const x = padding.left + (data.length === 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth)
    const y = padding.top + chartHeight - (item.minutes / maxMinutes) * chartHeight
    return { ...item, x, y }
  })
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`
  const tickValues = [maxMinutes, Math.round(maxMinutes / 2), 0]
  const labelInterval = data.length > 14 ? Math.ceil(data.length / 8) : 1
  const activeTooltipStyle = activePoint
    ? {
        left: `${(activePoint.x / width) * 100}%`,
        top: `${(activePoint.y / height) * 100}%`,
      }
    : undefined

  return (
    <div className="trend-chart-panel" role="img" aria-label="Downtime trend chart in minutes">
      <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs>
          <linearGradient id="downtimeLineGradient" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#59CDE9" />
            <stop offset="100%" stopColor="#59CDE9" />
          </linearGradient>
          <linearGradient id="downtimeAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#59CDE9" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#59CDE9" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {tickValues.map((tick) => {
          const y = padding.top + chartHeight - (tick / maxMinutes) * chartHeight
          return (
            <g key={tick}>
              <line className="trend-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="trend-axis-label" x={padding.left - 12} y={y + 4} textAnchor="end">
                {tick}m
              </text>
            </g>
          )
        })}
        <path className="trend-area" d={areaPath} />
        <path className="trend-line" d={linePath} />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle
              className={`trend-point ${activePoint?.label === point.label ? 'is-active' : ''}`}
              cx={point.x}
              cy={point.y}
              r={4}
            />
            <circle
              className="trend-hit-point"
              cx={point.x}
              cy={point.y}
              r={12}
              onMouseEnter={() => setActivePoint(point)}
              onMouseLeave={() => setActivePoint(null)}
              onFocus={() => setActivePoint(point)}
              onBlur={() => setActivePoint(null)}
              tabIndex={0}
              aria-label={`${point.label}: ${formatDowntimeDuration(point.minutes)}`}
            />
            {(index % labelInterval === 0 || index === points.length - 1) ? (
              <text className="trend-axis-label" x={point.x} y={height - 14} textAnchor="middle">
                {point.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {activePoint ? (
        <div className="trend-tooltip" style={activeTooltipStyle} role="status">
          <strong>{activePoint.label}</strong>
          <span>{formatDowntimeDuration(activePoint.minutes)}</span>
        </div>
      ) : null}
      <div className="trend-data-row" aria-hidden="true">
        {data.slice(-4).map((item) => (
          <span key={item.label}>{item.label}: {item.minutes}m</span>
        ))}
      </div>
    </div>
  )
}

function SkeletonBlock({ className = '' }) {
  return <div className={`skeleton ${className}`.trim()} aria-hidden="true" />
}

function statusClass(status) {
  if (status === 'Running') return 'status-running'
  if (status === 'Downtime') return 'status-downtime'
  return 'status-idle'
}

function StatusIcon({ status }) {
  if (status === 'Running') return <Wifi size={18} aria-hidden="true" />
  if (status === 'Downtime') return <AlertTriangle size={18} aria-hidden="true" />
  return <PauseCircle size={18} aria-hidden="true" />
}

export default function DashboardSection() {
  const [viewState, setViewState] = useState('loading')
  const [trendMode, setTrendMode] = useState('week')
  const [trendAnchorDate, setTrendAnchorDate] = useState(() => startOfDay(new Date()))
  const today = startOfDay(new Date())
  const trendData = getTrendData(trendMode, trendAnchorDate)
  const trendRangeLabel = getTrendRangeLabel(trendMode, trendAnchorDate)
  const calendarValue = trendMode === 'month' ? toMonthInputValue(trendAnchorDate) : toDateInputValue(trendAnchorDate)
  const calendarMax = trendMode === 'month' ? toMonthInputValue(today) : toDateInputValue(today)

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setViewState(overviewMockData.summary.length ? 'success' : 'empty')
    }, 350)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [])

  if (viewState === 'loading') {
    return (
      <div className="overview-layout">
        <div className="kpi-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="section-card stat-card">
              <SkeletonBlock className="skeleton-label" />
              <SkeletonBlock className="skeleton-value" />
              <SkeletonBlock className="skeleton-meta" />
            </div>
          ))}
        </div>
        <div className="section-grid">
          <div className="section-card">
            <SkeletonBlock className="skeleton-heading" />
            <SkeletonBlock className="skeleton-panel" />
          </div>
          <div className="section-card">
            <SkeletonBlock className="skeleton-heading" />
            <SkeletonBlock className="skeleton-panel" />
          </div>
        </div>
      </div>
    )
  }

  if (viewState === 'empty') {
    return (
      <section className="section-card section-placeholder" aria-labelledby="overview-empty-title">
        <div className="section-copy">
          <p className="section-eyebrow">No data</p>
          <h1 id="overview-empty-title">No overview data available</h1>
          <p>Connect live summary endpoints or seed mock operational data to populate the dashboard overview.</p>
        </div>
      </section>
    )
  }

  return (
    <div className="overview-layout">
      {overviewMockData.alerts.length > 0 ? (
        <div className="alerts-stack">
          {overviewMockData.alerts.map((alert) => (
            <div key={alert.id} className={`notice dashboard-alert ${alert.type === 'danger' ? 'notice-error' : ''}`} role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="kpi-grid">
        {overviewMockData.summary.map((item) => (
          <article key={item.id} className="section-card stat-card">
            <p className="stat-label">{item.label}</p>
            <p className="stat-value">{item.value}</p>
            <p className="stat-helper">{item.helper}</p>
          </article>
        ))}
      </div>

      <div className="section-grid">
        <section className="section-card">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Live status</p>
              <h2>Machine status</h2>
            </div>
          </div>
          <div className="machine-grid">
            {overviewMockData.machines.map((machine) => (
              <article key={machine.id} className={`machine-card ${statusClass(machine.status)}`}>
                <div className="machine-card-header">
                  <div>
                    <p className="machine-id">{machine.id}</p>
                    <h3>{machine.name}</h3>
                  </div>
                  <span className={`status-badge ${statusClass(machine.status)}`}>
                    <StatusIcon status={machine.status} />
                    {machine.status}
                  </span>
                </div>
                <dl className="machine-meta">
                  <div>
                    <dt>Pipe Count</dt>
                    <dd>{machine.pipeCount}</dd>
                  </div>
                  <div>
                    <dt>Sensor Signal</dt>
                    <dd>{machine.sensorSignal}</dd>
                  </div>
                  <div>
                    <dt>Last Event</dt>
                    <dd>{machine.lastEvent}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="section-card">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Downtime chart</p>
              <h2>Downtime trend</h2>
            </div>
            <div className="trend-controls" aria-label="Downtime chart controls">
              <div className="trend-mode-toggle" role="group" aria-label="Chart range">
                {trendModes.map((mode) => (
                  <button
                    key={mode.id}
                    className={`trend-mode-button ${trendMode === mode.id ? 'is-selected' : ''}`}
                    type="button"
                    aria-pressed={trendMode === mode.id}
                    onClick={() => {
                      setTrendMode(mode.id)
                      setTrendAnchorDate(startOfDay(new Date()))
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <div className="trend-calendar-control">
                <CalendarDays size={18} aria-hidden="true" />
                <label>
                  <span>{trendRangeLabel}</span>
                  <input
                    type={trendMode === 'month' ? 'month' : 'date'}
                    value={calendarValue}
                    max={calendarMax}
                    aria-label={trendMode === 'month' ? 'Select chart month' : 'Select chart date'}
                    onChange={(event) => {
                      setTrendAnchorDate(trendMode === 'month' ? fromMonthInputValue(event.target.value) : fromDateInputValue(event.target.value))
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
          <DowntimeChart data={trendData} />
        </section>
      </div>

      <section className="section-card">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Availability</p>
            <h2>Machine availability</h2>
          </div>
          <span className="section-chip">
            <TrendingUp size={16} aria-hidden="true" />
            Weekly target: 95%
          </span>
        </div>
        <div className="availability-list">
          {overviewMockData.availability.map((entry) => (
            <article key={entry.machineId} className="availability-row">
              <div className="availability-copy">
                <p>{entry.machineId}</p>
                <span>{entry.percent}% available</span>
              </div>
              <div className="availability-track" aria-hidden="true">
                <div className="availability-fill" style={{ width: `${entry.percent}%` }} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
