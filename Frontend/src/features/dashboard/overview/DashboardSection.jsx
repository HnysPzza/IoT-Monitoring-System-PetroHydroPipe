import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, TrendingUp } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import DowntimeTrendChart, {
  fromDateInputValue,
  fromMonthInputValue,
  getTrendRangeLabel,
  startOfDay,
  toDateInputValue,
  toMonthInputValue,
  trendModes,
} from './DowntimeTrendChart.jsx'
import ProductionAnalytics from './ProductionAnalytics.jsx'
import { getDashboardDowntimeImpact, getDashboardOverview } from './dashboardService.js'

function SkeletonBlock({ className = '' }) {
  return <div className={`skeleton ${className}`.trim()} aria-hidden="true" />
}

function OverviewLoadingState() {
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
      <div className="overview-summary-grid">
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

function OverviewNotice({ notice }) {
  if (!notice) return null

  return (
    <div className={`notice notice-${notice.type} dashboard-alert`} role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{notice.message}</span>
    </div>
  )
}

function OverviewEmptyState({ notice }) {
  return (
    <div className="overview-layout">
      <OverviewNotice notice={notice} />
      <section className="section-card section-placeholder" aria-labelledby="overview-empty-title">
        <div className="section-copy">
          <p className="section-eyebrow">No data</p>
          <h1 id="overview-empty-title">No overview data available</h1>
          <p>No overview data is available for the selected range.</p>
        </div>
      </section>
    </div>
  )
}

export default function DashboardSection() {
  const { token } = useAuth()
  const [viewState, setViewState] = useState('loading')
  const [overviewData, setOverviewData] = useState(null)
  const [notice, setNotice] = useState(null)
  const [downtimeChartState, setDowntimeChartState] = useState('loading')
  const [downtimeImpact, setDowntimeImpact] = useState(null)
  const [downtimeChartNotice, setDowntimeChartNotice] = useState(null)
  const [trendMode, setTrendMode] = useState('week')
  const [analyticsMode, setAnalyticsMode] = useState('day')
  const [trendAnchorDate, setTrendAnchorDate] = useState(() => startOfDay(new Date()))
  const today = startOfDay(new Date())
  const trendData = downtimeImpact?.points || []
  const trendRangeLabel = getTrendRangeLabel(trendMode, trendAnchorDate)
  const calendarValue = trendMode === 'month' ? toMonthInputValue(trendAnchorDate) : toDateInputValue(trendAnchorDate)
  const calendarMax = trendMode === 'month' ? toMonthInputValue(today) : toDateInputValue(today)

  useEffect(() => {
    let isMounted = true

    async function loadOverview() {
      setViewState('loading')
      setNotice(null)

      try {
        const payload = await getDashboardOverview(token)

        if (!isMounted) return

        setOverviewData(payload)
        setViewState(payload.summary?.length ? 'success' : 'empty')
      } catch (error) {
        if (!isMounted) return
        setNotice({ type: 'error', message: error.message || 'Unable to load dashboard overview.' })
        setOverviewData(null)
        setViewState('empty')
      }
    }

    loadOverview()

    return () => {
      isMounted = false
    }
  }, [token])

  useEffect(() => {
    let isMounted = true

    async function loadDowntimeImpact() {
      setDowntimeChartState('loading')
      setDowntimeChartNotice(null)

      try {
        const payload = await getDashboardDowntimeImpact(token, {
          trendMode,
          date: calendarValue,
        })

        if (!isMounted) return

        setDowntimeImpact(payload.downtimeImpact || null)
        setDowntimeChartState(payload.downtimeImpact?.points?.length ? 'success' : 'empty')
      } catch (error) {
        if (!isMounted) return
        setDowntimeChartNotice({ type: 'error', message: error.message || 'Unable to load downtime chart.' })
        setDowntimeChartState('error')
      }
    }

    loadDowntimeImpact()

    return () => {
      isMounted = false
    }
  }, [calendarValue, token, trendMode])

  if (viewState === 'loading') {
    return <OverviewLoadingState />
  }

  if (viewState === 'empty') {
    return <OverviewEmptyState notice={notice} />
  }

  return (
    <div className="overview-layout">
      {/* Overview stays high-level; detailed sensor status lives in /dashboard/live. */}
      <OverviewNotice notice={notice} />

      {overviewData.alerts.length > 0 ? (
        <div className="alerts-stack">
          {overviewData.alerts.map((alert) => (
            <div key={alert.id} className={`notice dashboard-alert ${alert.type === 'danger' ? 'notice-error' : ''}`} role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="kpi-grid">
        {overviewData.summary.map((item) => (
          <article key={item.id} className="section-card stat-card">
            <p className="stat-label">{item.label}</p>
            <p className="stat-value">{item.value}</p>
            <p className="stat-helper">{item.helper}</p>
          </article>
        ))}
      </div>

      {/* Production analytics compares current output with prior period and target. */}
      <ProductionAnalytics
        analytics={overviewData.productionAnalytics}
        mode={analyticsMode}
        onModeChange={setAnalyticsMode}
      />

      <div className="overview-summary-grid">
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
                <label htmlFor="overview-downtime-chart-date">
                  <span>{trendRangeLabel}</span>
                  <input
                    id="overview-downtime-chart-date"
                    name="overviewDowntimeChartDate"
                    type={trendMode === 'month' ? 'month' : 'date'}
                    value={calendarValue}
                    max={calendarMax}
                    autoComplete="off"
                    aria-label={trendMode === 'month' ? 'Select chart month' : 'Select chart date'}
                    onChange={(event) => {
                      setTrendAnchorDate(trendMode === 'month' ? fromMonthInputValue(event.target.value) : fromDateInputValue(event.target.value))
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
          {downtimeChartNotice ? (
            <div className={`notice notice-${downtimeChartNotice.type} dashboard-alert`} role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{downtimeChartNotice.message}</span>
            </div>
          ) : null}
          {downtimeChartState === 'loading' ? (
            <div className="skeleton skeleton-panel" />
          ) : trendData.length > 0 ? (
            <DowntimeTrendChart data={trendData} thresholdMinutes={downtimeImpact?.thresholdMinutes || 30} />
          ) : (
            <p className="table-muted">No downtime trend data is available for this range.</p>
          )}
        </section>

        <section className="section-card">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Availability</p>
              <h2>Machine and sensor availability</h2>
            </div>
            <span className="section-chip">
              <TrendingUp size={16} aria-hidden="true" />
              Weekly target: 95%
            </span>
          </div>
          <div className="availability-list">
            {overviewData.availability.map((entry) => (
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
    </div>
  )
}
