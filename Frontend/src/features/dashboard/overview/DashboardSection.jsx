import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, CircleCheck, Clock3, Factory, PackageCheck, PauseCircle, Target } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { sensorIdentities } from '../../../shared/constants/sensorIdentity.js'
import { formatLiveDateTime, formatNumber } from '../../../shared/utils/formatters.js'
import { getLiveStatusClass } from '../../../shared/utils/statusClasses.js'
import { getLiveFeed } from '../live/liveService.js'
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
      <div className="overview-charts-grid">
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

function SensorStatusIcon({ status }) {
  if (status === 'Downtime') {
    return <AlertTriangle size={16} aria-hidden="true" />
  }

  if (status === 'Idle' || status === 'Unavailable') {
    return <PauseCircle size={16} aria-hidden="true" />
  }

  return <CircleCheck size={16} aria-hidden="true" />
}

export default function DashboardSection() {
  const { token } = useAuth()
  const [viewState, setViewState] = useState('loading')
  const [overviewData, setOverviewData] = useState(null)
  const [liveData, setLiveData] = useState({ machine: null, sensors: [] })
  const [notice, setNotice] = useState(null)
  const [downtimeChartState, setDowntimeChartState] = useState('loading')
  const [downtimeImpact, setDowntimeImpact] = useState(null)
  const [downtimeChartNotice, setDowntimeChartNotice] = useState(null)
  const [trendMode, setTrendMode] = useState('today')
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
        const [payload, livePayload] = await Promise.all([
          getDashboardOverview(token),
          getLiveFeed(token).catch(() => ({ machine: null, sensors: [] })),
        ])

        if (!isMounted) return

        setOverviewData(payload)
        setLiveData({
          machine: livePayload.machine || null,
          sensors: livePayload.sensors || [],
        })
        setViewState(payload.summary?.length ? 'success' : 'empty')
      } catch (error) {
        if (!isMounted) return
        setNotice({ type: 'error', message: error.message || 'Unable to load dashboard overview.' })
        setOverviewData(null)
        setLiveData({ machine: null, sensors: [] })
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

  const selectedAnalytics = overviewData.productionAnalytics?.[analyticsMode]
  const summaryById = Object.fromEntries(overviewData.summary.map((item) => [item.id, item]))
  const productionSummary = summaryById.pipes || overviewData.summary[0]
  const downtimeSummary = summaryById.minutes || overviewData.summary.find((item) => item.label.toLowerCase().includes('downtime'))
  const machineIsAvailable = Boolean(liveData.machine)
  const kpiItems = [
    {
      id: 'production',
      label: 'Production Output',
      value: selectedAnalytics ? `${formatNumber(selectedAnalytics.currentTotal)} ${selectedAnalytics.unit}` : productionSummary?.value || '—',
      helper: selectedAnalytics?.currentLabel || productionSummary?.helper || 'Current period',
      icon: PackageCheck,
      tone: 'success',
    },
    {
      id: 'machine',
      label: 'Machine Online',
      value: machineIsAvailable ? '1 / 1' : '—',
      helper: liveData.machine?.name || 'Spiral Mill 01',
      icon: Factory,
      tone: machineIsAvailable ? 'success' : 'neutral',
    },
    {
      id: 'downtime',
      label: 'Downtime',
      value: downtimeSummary?.value || '0 min',
      helper: downtimeSummary?.helper || 'Current period',
      icon: Clock3,
      tone: 'warning',
    },
    {
      id: 'target',
      label: 'Target Production Output',
      value: selectedAnalytics ? `${formatNumber(selectedAnalytics.targetTotal)} ${selectedAnalytics.unit}` : '—',
      helper: selectedAnalytics?.label || 'Selected period',
      icon: Target,
      tone: 'primary',
    },
  ]
  const sensorHealth = sensorIdentities.map((identity) => {
    const sensor = liveData.sensors.find((entry) => entry.sensorCode === identity.code)
    return {
      ...identity,
      ...sensor,
      status: sensor?.status || 'Unavailable',
    }
  })
  const reportingSensorCount = sensorHealth.filter((sensor) => sensor.status !== 'Unavailable').length

  return (
    <div className="overview-layout">
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
        {kpiItems.map((item) => {
          const Icon = item.icon
          return (
            <article key={item.id} className={`section-card stat-card stat-card-${item.tone}`}>
              <div className="stat-card-heading">
                <span className="stat-card-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <p className="stat-label">{item.label}</p>
              </div>
              <p className="stat-value">{item.value}</p>
              <p className="stat-helper">{item.helper}</p>
            </article>
          )
        })}
      </div>

      <div className="overview-charts-grid">
        <ProductionAnalytics
          analytics={overviewData.productionAnalytics}
          mode={analyticsMode}
          onModeChange={setAnalyticsMode}
        />

        <section className="section-card downtime-chart-card">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Downtime chart</p>
              <h2>Downtime by Period</h2>
            </div>
            <div className="trend-controls" aria-label="Downtime chart controls">
              <div className="trend-mode-toggle" role="group" aria-label="Chart range">
                {trendModes.map((mode) => (
                  <button
                    key={mode.id}
                    className={`trend-mode-button ${trendMode === mode.id ? 'is-selected' : ''}`}
                    type="button"
                    disabled={mode.disabled}
                    title={mode.disabled ? 'Last Hour is not available yet' : undefined}
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
            <p className="table-muted">No downtime data is available for this range.</p>
          )}
        </section>
      </div>

      <section className="section-card machine-health-card" aria-labelledby="machine-health-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Machine health</p>
            <h2 id="machine-health-title">{liveData.machine?.name || 'Spiral Mill 01'}</h2>
          </div>
          <span className="section-chip">
            <CircleCheck size={16} aria-hidden="true" />
            {reportingSensorCount} / 5 sensors reporting
          </span>
        </div>

        <div className="overview-sensor-grid" aria-label="Five inductive proximity sensor statuses">
          {sensorHealth.map((sensor) => (
            <article key={sensor.code} className={`overview-sensor-card ${getLiveStatusClass(sensor.status)}`}>
              <div className="overview-sensor-heading">
                <span className="sensor-state-icon" aria-hidden="true">
                  <SensorStatusIcon status={sensor.status} />
                </span>
                <div>
                  <p>{sensor.code}</p>
                  <h3>{sensor.label}</h3>
                </div>
              </div>
              <div className="overview-sensor-footer">
                <span className={`status-badge ${getLiveStatusClass(sensor.status)}`}>{sensor.status}</span>
                <span>{sensor.lastEventAt ? `Last event ${formatLiveDateTime(sensor.lastEventAt)}` : 'No recent event'}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
