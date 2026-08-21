import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, CircleCheck, Clock3, Factory, MoveRight, PackageCheck, PauseCircle, RotateCw, Target } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { sensorIdentities } from '../../../shared/constants/sensorIdentity.js'
import { formatLiveDateTime, formatNumber } from '../../../shared/utils/formatters.js'
import { getLiveStatusClass } from '../../../shared/utils/statusClasses.js'
import { getLiveFeed } from '../live/liveService.js'
import DowntimeTrendChart, {
  getTrendRangeLabel,
  startOfDay,
  toDateInputValue,
  toMonthInputValue,
  trendModes,
} from './DowntimeTrendChart.jsx'
import ProductionAnalytics from './ProductionAnalytics.jsx'
import TrendCalendarControl from './TrendCalendarControl.jsx'
import { getDashboardDowntimeImpact, getDashboardOverview } from './dashboardService.js'

function SkeletonBlock({ className = '', style }) {
  return <div className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />
}

function DowntimeChartSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading downtime chart...</span>
      <div className="skeleton skeleton-chart-panel" aria-hidden="true" />
    </div>
  )
}

function ProductionAnalyticsSkeleton() {
  return (
    <section className="section-card production-analytics-card" aria-label="Loading production analytics">
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">Data analytics</p>
          <SkeletonBlock className="skeleton-heading" />
        </div>
        <div className="trend-controls-skeleton" aria-hidden="true">
          <SkeletonBlock className="skeleton-toggle" style={{ width: '180px' }} />
        </div>
      </div>
      <div className="skeleton skeleton-chart-panel" aria-hidden="true" />
    </section>
  )
}

function OverviewLoadingState() {
  return (
    <div className="kpi-grid" role="status" aria-live="polite">
      <span className="sr-only">Loading dashboard overview...</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="section-card stat-card">
          <SkeletonBlock className="skeleton-label" />
          <SkeletonBlock className="skeleton-value" />
          <SkeletonBlock className="skeleton-meta" />
        </div>
      ))}
    </div>
  )
}

function OverviewEmptyState() {
  return (
    <section className="section-card section-placeholder" aria-labelledby="overview-empty-title">
      <div className="section-copy">
        <p className="section-eyebrow">No data</p>
        <h2 id="overview-empty-title">No overview data available</h2>
        <p>No overview data is available for the selected range.</p>
      </div>
    </section>
  )
}

function formatSuccessfulUpdate(date) {
  return date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  })
}

function getRequestDisplayState({ state, hasCurrentData, errorKey, currentKey }) {
  if (state === 'error') {
    return errorKey === currentKey ? 'error' : 'loading'
  }

  return hasCurrentData ? state : 'loading'
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
  const [overviewState, setOverviewState] = useState('loading')
  const [overviewData, setOverviewData] = useState(null)
  const [overviewRequestKey, setOverviewRequestKey] = useState('')
  const [overviewError, setOverviewError] = useState('')
  const [overviewErrorKey, setOverviewErrorKey] = useState('')
  const [overviewRefresh, setOverviewRefresh] = useState(0)
  const overviewRequestIdRef = useRef(0)
  const [liveState, setLiveState] = useState('loading')
  const [liveData, setLiveData] = useState({ machine: null, sensors: [] })
  const [liveRequestKey, setLiveRequestKey] = useState('')
  const [liveError, setLiveError] = useState('')
  const [liveErrorKey, setLiveErrorKey] = useState('')
  const [liveLastUpdated, setLiveLastUpdated] = useState(null)
  const [liveRefresh, setLiveRefresh] = useState(0)
  const liveRequestIdRef = useRef(0)
  const successfulLiveRef = useRef(null)
  const [downtimeChartState, setDowntimeChartState] = useState('loading')
  const [downtimeImpact, setDowntimeImpact] = useState(null)
  const [downtimeChartRequestKey, setDowntimeChartRequestKey] = useState('')
  const [downtimeChartError, setDowntimeChartError] = useState('')
  const [downtimeChartErrorKey, setDowntimeChartErrorKey] = useState('')
  const [downtimeChartLastUpdated, setDowntimeChartLastUpdated] = useState(null)
  const [downtimeChartRefresh, setDowntimeChartRefresh] = useState(0)
  const downtimeChartRequestIdRef = useRef(0)
  const successfulDowntimeChartRef = useRef(null)
  const [trendMode, setTrendMode] = useState('today')
  const [analyticsMode, setAnalyticsMode] = useState('day')
  const [trendAnchorDate, setTrendAnchorDate] = useState(() => startOfDay(new Date()))
  const today = startOfDay(new Date())
  const trendRangeLabel = getTrendRangeLabel(trendMode, trendAnchorDate)
  const calendarValue = trendMode === 'month' ? toMonthInputValue(trendAnchorDate) : toDateInputValue(trendAnchorDate)
  const overviewKey = `${token || 'anonymous'}:overview`
  const liveKey = `${token || 'anonymous'}:live`
  const downtimeChartKey = `${token || 'anonymous'}:${trendMode}:${calendarValue}`
  const hasCurrentOverview = overviewRequestKey === overviewKey && Boolean(overviewData)
  const hasCurrentLive = liveRequestKey === liveKey
  const hasCurrentDowntimeChart = downtimeChartRequestKey === downtimeChartKey
  const trendData = hasCurrentDowntimeChart ? downtimeImpact?.points || [] : []

  useEffect(() => {
    const requestId = overviewRequestIdRef.current + 1
    overviewRequestIdRef.current = requestId
    let isCancelled = false

    async function loadOverview() {
      setOverviewState('loading')
      setOverviewError('')

      try {
        const payload = await getDashboardOverview(token)
        if (isCancelled || requestId !== overviewRequestIdRef.current) return

        setOverviewData(payload)
        setOverviewRequestKey(overviewKey)
        setOverviewState(payload.summary?.length ? 'success' : 'empty')
      } catch (error) {
        if (isCancelled || requestId !== overviewRequestIdRef.current) return
        setOverviewError(error.message || 'Unable to load dashboard overview.')
        setOverviewErrorKey(overviewKey)
        setOverviewState('error')
      }
    }

    loadOverview()

    return () => {
      isCancelled = true
    }
  }, [overviewKey, overviewRefresh, token])

  useEffect(() => {
    const requestId = liveRequestIdRef.current + 1
    liveRequestIdRef.current = requestId
    let isCancelled = false

    async function loadLiveStatus() {
      setLiveState('loading')
      setLiveError('')

      try {
        const payload = await getLiveFeed(token)
        if (isCancelled || requestId !== liveRequestIdRef.current) return

        const nextLiveData = {
          machine: payload.machine || null,
          sensors: payload.sensors || [],
        }
        const updatedAt = new Date()
        successfulLiveRef.current = { requestKey: liveKey, data: nextLiveData, updatedAt }
        setLiveData(nextLiveData)
        setLiveRequestKey(liveKey)
        setLiveLastUpdated(updatedAt)
        setLiveState('success')
      } catch (error) {
        if (isCancelled || requestId !== liveRequestIdRef.current) return

        setLiveError(error.message || 'Unable to load live machine status.')
        setLiveErrorKey(liveKey)
        if (successfulLiveRef.current?.requestKey === liveKey) {
          setLiveData(successfulLiveRef.current.data)
          setLiveRequestKey(liveKey)
          setLiveLastUpdated(successfulLiveRef.current.updatedAt)
          setLiveState('stale')
        } else {
          setLiveState('error')
        }
      }
    }

    loadLiveStatus()

    return () => {
      isCancelled = true
    }
  }, [liveKey, liveRefresh, token])

  useEffect(() => {
    const requestId = downtimeChartRequestIdRef.current + 1
    downtimeChartRequestIdRef.current = requestId
    let isCancelled = false

    async function loadDowntimeImpact() {
      setDowntimeChartState('loading')
      setDowntimeChartError('')

      try {
        const payload = await getDashboardDowntimeImpact(token, {
          trendMode,
          date: calendarValue,
        })

        if (isCancelled || requestId !== downtimeChartRequestIdRef.current) return

        const nextImpact = payload.downtimeImpact || null
        const updatedAt = new Date()
        successfulDowntimeChartRef.current = { requestKey: downtimeChartKey, data: nextImpact, updatedAt }
        setDowntimeImpact(nextImpact)
        setDowntimeChartRequestKey(downtimeChartKey)
        setDowntimeChartLastUpdated(updatedAt)
        setDowntimeChartState(nextImpact?.points?.length ? 'success' : 'empty')
      } catch (error) {
        if (isCancelled || requestId !== downtimeChartRequestIdRef.current) return

        setDowntimeChartError(error.message || 'Unable to load downtime chart.')
        setDowntimeChartErrorKey(downtimeChartKey)
        if (successfulDowntimeChartRef.current?.requestKey === downtimeChartKey) {
          setDowntimeImpact(successfulDowntimeChartRef.current.data)
          setDowntimeChartRequestKey(downtimeChartKey)
          setDowntimeChartLastUpdated(successfulDowntimeChartRef.current.updatedAt)
          setDowntimeChartState('stale')
        } else {
          setDowntimeChartState('error')
        }
      }
    }

    loadDowntimeImpact()

    return () => {
      isCancelled = true
    }
  }, [calendarValue, downtimeChartKey, downtimeChartRefresh, token, trendMode])

  const overviewDisplayState = getRequestDisplayState({
    state: overviewState,
    hasCurrentData: hasCurrentOverview,
    errorKey: overviewErrorKey,
    currentKey: overviewKey,
  })
  const chartDisplayState = getRequestDisplayState({
    state: downtimeChartState,
    hasCurrentData: hasCurrentDowntimeChart,
    errorKey: downtimeChartErrorKey,
    currentKey: downtimeChartKey,
  })
  const liveDisplayState = getRequestDisplayState({
    state: liveState,
    hasCurrentData: hasCurrentLive,
    errorKey: liveErrorKey,
    currentKey: liveKey,
  })
  const overviewIsReady = overviewDisplayState === 'success' && hasCurrentOverview
  const selectedAnalytics = overviewIsReady ? overviewData.productionAnalytics?.[analyticsMode] : null
  const summaryById = overviewIsReady
    ? Object.fromEntries(overviewData.summary.map((item) => [item.id, item]))
    : {}
  const productionSummary = overviewIsReady ? summaryById.pipes || overviewData.summary[0] : null
  const downtimeSummary = overviewIsReady
    ? summaryById.minutes || overviewData.summary.find((item) => item.label.toLowerCase().includes('downtime'))
    : null
  const machineKpi = (() => {
    if (liveDisplayState === 'success' && hasCurrentLive && liveData.machine) {
      return { value: '1 / 1', helper: liveData.machine.name || 'Spiral Mill 01', tone: 'success' }
    }

    if (liveDisplayState === 'stale') {
      return { value: 'Stale', helper: 'Live status needs refresh', tone: 'warning' }
    }

    if (liveDisplayState === 'error') {
      return { value: '—', helper: 'Live status unavailable', tone: 'neutral' }
    }

    if (liveDisplayState === 'loading') {
      return { value: '—', helper: 'Refreshing live status', tone: 'neutral' }
    }

    return { value: '—', helper: 'No live machine returned', tone: 'neutral' }
  })()
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
      value: machineKpi.value,
      helper: machineKpi.helper,
      icon: Factory,
      tone: machineKpi.tone,
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
  const isUnifiedRefreshing = overviewState === 'loading' || liveState === 'loading' || downtimeChartState === 'loading'

  const handleUnifiedRefresh = () => {
    setOverviewRefresh((current) => current + 1)
    setLiveRefresh((current) => current + 1)
    setDowntimeChartRefresh((current) => current + 1)
  }

  return (
    <div className="overview-layout">
      <div className="overview-controls-card">
        <div className="overview-meta-strip">
          <span className="overview-meta-item">
            <Factory size={16} aria-hidden="true" />
            <span>Machine:</span>
            <strong>{hasCurrentLive && liveData.machine ? (liveData.machine.name || 'Spiral Mill 01') : 'Spiral Mill 01'}</strong>
          </span>
          <span className="overview-meta-item">
            <CircleCheck size={16} aria-hidden="true" />
            <span>Sensors:</span>
            <strong>{hasCurrentLive ? `${reportingSensorCount} / 5 reporting` : '5 / 5 reporting'}</strong>
          </span>
          <span className="overview-meta-item">
            <Clock3 size={16} aria-hidden="true" />
            <span>Last sync:</span>
            <strong>{hasCurrentLive && liveLastUpdated ? formatSuccessfulUpdate(liveLastUpdated) : 'Active session'}</strong>
          </span>
        </div>
        <button
          className="btn btn-success overview-refresh-button"
          type="button"
          aria-label="Refresh overview data"
          disabled={isUnifiedRefreshing}
          onClick={handleUnifiedRefresh}
        >
          <RotateCw className={isUnifiedRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {overviewDisplayState === 'loading' && !hasCurrentOverview ? <OverviewLoadingState /> : null}

      {overviewDisplayState === 'error' ? (
        <section className="section-card section-placeholder" aria-labelledby="overview-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Overview unavailable</p>
            <h2 id="overview-error-title">Unable to load dashboard overview</h2>
            <p role="alert">{overviewError}</p>
            <button className="btn btn-secondary" type="button" onClick={() => setOverviewRefresh((current) => current + 1)}>
              Retry overview
            </button>
          </div>
        </section>
      ) : null}

      {overviewDisplayState === 'empty' && hasCurrentOverview ? <OverviewEmptyState /> : null}

      {overviewIsReady && overviewData.alerts.length > 0 ? (
        <div className="alerts-stack">
          {(() => {
            const primaryAlert = overviewData.alerts[0]
            const extraCount = overviewData.alerts.length - 1
            return (
              <div
                className={`notice dashboard-alert overview-alert-banner ${primaryAlert.type === 'danger' ? 'notice-error' : ''}`}
                role="alert"
              >
                <div className="overview-alert-lead">
                  <AlertTriangle size={16} aria-hidden="true" className="overview-alert-icon" />
                  <span className="overview-alert-message">{primaryAlert.message}</span>
                </div>
                {extraCount > 0 ? (
                  <Link
                    to="/dashboard/downtime"
                    className="overview-alert-more-link"
                    aria-label={`+${extraCount} more active alerts. View all on downtime page.`}
                  >
                    <span className="overview-alert-count">+{extraCount} more active alert{extraCount > 1 ? 's' : ''}</span>
                    <span className="meta-separator" aria-hidden="true">→</span>
                    <span className="overview-alert-action-label">View all</span>
                    <MoveRight size={13} aria-hidden="true" />
                  </Link>
                ) : (
                  <Link
                    to="/dashboard/downtime"
                    className="overview-alert-more-link single-link"
                    aria-label="View downtime logs"
                  >
                    <span className="overview-alert-action-label">View all</span>
                    <MoveRight size={13} aria-hidden="true" />
                  </Link>
                )}
              </div>
            )
          })()}
        </div>
      ) : null}

      {overviewIsReady ? <div className="kpi-grid">
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
      </div> : null}

      <div className="overview-charts-grid">
        {overviewIsReady ? (
          <ProductionAnalytics
            analytics={overviewData.productionAnalytics}
            mode={analyticsMode}
            onModeChange={setAnalyticsMode}
          />
        ) : overviewDisplayState === 'loading' && !hasCurrentOverview ? (
          <ProductionAnalyticsSkeleton />
        ) : null}

        <section className="section-card downtime-chart-card">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Downtime chart</p>
              {chartDisplayState === 'loading' && !hasCurrentDowntimeChart ? (
                <SkeletonBlock className="skeleton-heading" />
              ) : (
                <h2>Downtime by Period</h2>
              )}
            </div>
            {chartDisplayState === 'loading' && !hasCurrentDowntimeChart ? (
              <div className="trend-controls-skeleton" aria-hidden="true">
                <SkeletonBlock className="skeleton-toggle" />
                <SkeletonBlock className="skeleton-control" />
              </div>
            ) : (
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
                <TrendCalendarControl
                  mode={trendMode}
                  selectedDate={trendAnchorDate}
                  maxDate={today}
                  rangeLabel={trendRangeLabel}
                  onDateChange={setTrendAnchorDate}
                />
              </div>
            )}
          </div>
          {downtimeChartState === 'stale' && hasCurrentDowntimeChart ? (
            <div className="notice notice-error dashboard-alert" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                Downtime chart data is stale. Showing the last successful result from{' '}
                <time dateTime={downtimeChartLastUpdated?.toISOString()}>
                  {downtimeChartLastUpdated ? formatSuccessfulUpdate(downtimeChartLastUpdated) : 'an earlier update'}
                </time>
                . {downtimeChartError}
              </span>
              <button className="btn btn-secondary table-action-button" type="button" onClick={() => setDowntimeChartRefresh((current) => current + 1)}>
                Retry chart
              </button>
            </div>
          ) : null}
          {chartDisplayState === 'loading' && hasCurrentDowntimeChart ? (
            <div className="notice dashboard-alert" role="status" aria-live="polite">
              Refreshing downtime chart...
            </div>
          ) : null}
          {chartDisplayState === 'error' ? (
            <div className="notice notice-error dashboard-alert" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{downtimeChartError}</span>
              <button className="btn btn-secondary table-action-button" type="button" onClick={() => setDowntimeChartRefresh((current) => current + 1)}>
                Retry chart
              </button>
            </div>
          ) : chartDisplayState === 'loading' && !hasCurrentDowntimeChart ? (
            <DowntimeChartSkeleton />
          ) : trendData.length > 0 ? (
            <DowntimeTrendChart data={trendData} thresholdMinutes={downtimeImpact?.thresholdMinutes || 30} />
          ) : hasCurrentDowntimeChart ? (
            <p className="table-muted">No downtime data is available for this range.</p>
          ) : null}
        </section>
      </div>

      {liveDisplayState === 'error' ? (
        <section className="section-card section-placeholder" aria-labelledby="live-source-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Live source unavailable</p>
            <h2 id="live-source-error-title">Unable to load live machine status</h2>
            <p role="alert">{liveError}</p>
            <button className="btn btn-secondary" type="button" onClick={() => setLiveRefresh((current) => current + 1)}>
              Retry live status
            </button>
          </div>
        </section>
      ) : liveDisplayState === 'loading' && !hasCurrentLive ? (
        <section className="section-card machine-health-card" aria-label="Loading live machine status">
          <SkeletonBlock className="skeleton-heading" />
          <SkeletonBlock className="skeleton-panel" />
        </section>
      ) : hasCurrentLive && !liveData.machine ? (
        <section className="section-card section-placeholder" aria-labelledby="live-source-empty-title">
          <div className="section-copy">
            <p className="section-eyebrow">No live source</p>
            <h2 id="live-source-empty-title">No live machine is available</h2>
            <p>No monitored machine was returned by the last successful live-status request.</p>
            {liveState === 'loading' ? (
              <div className="notice dashboard-alert" role="status" aria-live="polite">Refreshing live status...</div>
            ) : null}
            {liveState === 'stale' ? (
              <div className="notice notice-error dashboard-alert" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>
                  Live machine status is stale. The last successful empty result was received at{' '}
                  <time dateTime={liveLastUpdated?.toISOString()}>
                    {liveLastUpdated ? formatSuccessfulUpdate(liveLastUpdated) : 'an earlier update'}
                  </time>
                  . {liveError}
                </span>
                <button className="btn btn-secondary table-action-button" type="button" onClick={() => setLiveRefresh((current) => current + 1)}>
                  Retry live status
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : hasCurrentLive ? (
        <section className="section-card machine-health-card" aria-labelledby="machine-health-title">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Machine health</p>
              <h2 id="machine-health-title">{liveData.machine?.name || 'Spiral Mill 01'}</h2>
            </div>
            <div className="live-refresh">
              <span className="section-chip">
                <CircleCheck size={16} aria-hidden="true" />
                {reportingSensorCount} / 5 sensors reporting
              </span>
            </div>
          </div>

          {liveState === 'loading' ? (
            <div className="notice dashboard-alert" role="status" aria-live="polite">Refreshing live status...</div>
          ) : null}

          {liveState === 'stale' ? (
            <div className="notice notice-error dashboard-alert" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                Live machine status is stale. Showing the last successful result from{' '}
                <time dateTime={liveLastUpdated?.toISOString()}>
                  {liveLastUpdated ? formatSuccessfulUpdate(liveLastUpdated) : 'an earlier update'}
                </time>
                . {liveError}
              </span>
              <button className="btn btn-secondary table-action-button" type="button" onClick={() => setLiveRefresh((current) => current + 1)}>
                Retry live status
              </button>
            </div>
          ) : null}

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
      ) : null}
    </div>
  )
}
