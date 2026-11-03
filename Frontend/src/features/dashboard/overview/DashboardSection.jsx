import './overview.css'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useOutletContext } from 'react-router'
import { AlertTriangle, CircleCheck, Clock3, Factory, MoveRight, PackageCheck, PauseCircle, RotateCw, TrendingDown, TrendingUp, Wrench } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { onlineManager } from '@tanstack/react-query'
import UpdatedAgo from '../../../shared/components/UpdatedAgo.jsx'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { sensorIdentities } from '../../../shared/constants/sensorIdentity.js'
import { formatLiveDateTime, formatNumber } from '../../../shared/utils/formatters.js'
import { getLiveStatusClass } from '../../../shared/utils/statusClasses.js'
import { getAlertDestination, getAlertKind } from '../../../shared/utils/alertPresentation.js'
import { getLiveFeed } from '../live/liveService.js'
import { connectivityLabel, getProcessIdleBanner, getProcessSensorFaultBanner } from '../live/livePresentation.js'
import DowntimeTrendChart, {
  getTrendRangeLabel,
  fromDateInputValue,
  toDateInputValue,
  toMonthInputValue,
} from './DowntimeTrendChart.jsx'
import ProductionAnalytics from './ProductionAnalytics.jsx'
import TrendCalendarControl from './TrendCalendarControl.jsx'
import { getDashboardDowntimeImpact, getDashboardOverview } from './dashboardService.js'
import { getManilaDateInputValue } from '../analytics/analyticsService.js'

const AUTO_REFRESH_MS = 60 * 1000

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

function isRecoveryPendingAlert(alert) {
  return alert?.status === 'Active' && alert.metadata?.recoveryPending === true
}

function orderOverviewAlerts(alerts) {
  return [...alerts].sort(
    (left, right) => Number(isRecoveryPendingAlert(left)) - Number(isRecoveryPendingAlert(right)),
  )
}

function getOverviewAlertMessage(alert) {
  return isRecoveryPendingAlert(alert)
    ? 'This alert recovered. Acknowledgement required.'
    : alert.message
}

function isDangerOverviewAlert(alert) {
  return alert?.type === 'danger'
    || alert?.severity === 'Critical'
    || getAlertKind(alert) !== null
}

export default function DashboardSection() {
  const { token } = useAuth()
  const alertContext = useOutletContext()
  const [liveState, setLiveState] = useState('loading')
  const [liveData, setLiveData] = useState({ machine: null, sensors: [], monitoringMode: 'unknown' })
  const [liveRequestKey, setLiveRequestKey] = useState('')
  const [liveError, setLiveError] = useState('')
  const [liveErrorKey, setLiveErrorKey] = useState('')
  const [liveLastUpdated, setLiveLastUpdated] = useState(null)
  const [liveRefresh, setLiveRefresh] = useState(0)
  const liveRequestIdRef = useRef(0)
  const successfulLiveRef = useRef(null)
  const wasOfflineRef = useRef(false)
  const [trendMode, setTrendMode] = useState('today')
  const [trendAnchorDate, setTrendAnchorDate] = useState(() => fromDateInputValue(getManilaDateInputValue()))
  const today = fromDateInputValue(getManilaDateInputValue())
  const trendRangeLabel = getTrendRangeLabel(trendMode, trendAnchorDate)
  const calendarValue = trendMode === 'month' ? toMonthInputValue(trendAnchorDate) : toDateInputValue(trendAnchorDate)
  const online = useNetworkOnline()
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true
      if (successfulLiveRef.current) {
        setLiveState('stale')
        setLiveError('Unable to refresh while offline.')
      }
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false
      setLiveRefresh((current) => current + 1)
    }
  }, [online])
  const overviewQuery = useAuthenticatedQuery({
    queryKey: queryKeys.overview.summary,
    queryFn: ({ token: currentToken, signal }) => getDashboardOverview(currentToken, {}, { signal }),
    staleTime: 20000,
  })
  const chartQuery = useAuthenticatedQuery({
    queryKey: queryKeys.overview.downtimeImpact({ trendMode, date: calendarValue }),
    queryFn: async ({ token: currentToken, signal }) => (await getDashboardDowntimeImpact(currentToken, { trendMode, date: calendarValue }, { signal })).downtimeImpact || null,
    staleTime: 20000,
  })
  const overviewData = overviewQuery.data
  const hasCurrentOverview = Boolean(overviewData)
  const overviewError = overviewQuery.error?.message || (!online ? 'Unable to refresh while offline.' : 'Unable to load dashboard overview.')
  const overviewState = overviewQuery.isError || !online ? (overviewData ? 'stale' : 'error') : overviewQuery.isFetching || !overviewData ? 'loading' : overviewData.summary?.length ? 'success' : 'empty'
  const overviewDisplayState = overviewState
  const downtimeImpact = chartQuery.data
  const hasCurrentDowntimeChart = chartQuery.data !== undefined
  const hasLoadedChartRef = useRef(false)
  if (hasCurrentDowntimeChart) hasLoadedChartRef.current = true
  const hasLoadedInitialChart = hasLoadedChartRef.current
  const downtimeChartLastUpdated = chartQuery.dataUpdatedAt ? new Date(chartQuery.dataUpdatedAt) : null
  const downtimeChartError = chartQuery.error?.message || (!online ? 'Unable to refresh while offline.' : 'Unable to load downtime chart.')
  const downtimeChartState = chartQuery.isError || !online ? (hasCurrentDowntimeChart ? 'stale' : 'error') : chartQuery.isFetching || !hasCurrentDowntimeChart ? 'loading' : downtimeImpact?.points?.length ? 'success' : 'empty'
  const chartDisplayState = downtimeChartState
  const liveKey = `${token || 'anonymous'}:live`
  const hasCurrentLive = liveRequestKey === liveKey
  const trendData = hasCurrentDowntimeChart ? downtimeImpact?.points || [] : []
  const trustedOverviewAlerts = alertContext?.unresolvedAlerts ?? alertContext?.activeAlerts ?? []
  const overviewAlerts = orderOverviewAlerts(alertContext?.hasTrustedAlertList
    ? trustedOverviewAlerts
    : overviewQuery.isFetchedAfterMount && !overviewQuery.isError && online ? overviewData?.alerts || [] : [])
  const overviewAlertDestinations = Array.from(new Map(overviewAlerts.map((alert) => {
    const destination = getAlertDestination(alert)
    return [destination.to, destination]
  })).values())
  const fallbackSensorFaultBanner = hasCurrentLive && overviewAlerts.length === 0
    ? getProcessSensorFaultBanner(liveData.sensors, liveData.monitoringMode)
    : null
  const processIdleBanner = hasCurrentLive
    ? getProcessIdleBanner(liveData.sensors, liveData.monitoringMode)
    : null

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void overviewQuery.refetch()
      void chartQuery.refetch()
      setLiveRefresh((current) => current + 1)
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(intervalId)
  }, [liveKey, overviewQuery.refetch, chartQuery.refetch])

  useEffect(() => {
    const requestId = liveRequestIdRef.current + 1
    liveRequestIdRef.current = requestId
    let isCancelled = false

    async function loadLiveStatus() {
      setLiveState((current) => current === 'stale' ? 'stale' : 'loading')
      setLiveError('')

      try {
        const payload = await getLiveFeed(token)
        if (isCancelled || requestId !== liveRequestIdRef.current) return
        if (!onlineManager.isOnline()) return

        const nextLiveData = {
          machine: payload.machine || null,
          sensors: payload.sensors || [],
          monitoringMode: payload.monitoring?.mode || 'unknown',
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

  const liveDisplayState = getRequestDisplayState({
    state: liveState,
    hasCurrentData: hasCurrentLive,
    errorKey: liveErrorKey,
    currentKey: liveKey,
  })
  const overviewIsReady = hasCurrentOverview
    && (overviewDisplayState === 'success' || overviewDisplayState === 'loading' || overviewDisplayState === 'stale')
  const selectedAnalytics = overviewIsReady ? overviewData.productionAnalytics?.day : null
  const productionDifference = selectedAnalytics?.difference ?? 0
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
      id: 'comparison',
      label: 'Difference from Yesterday',
      value: selectedAnalytics ? `${productionDifference > 0 ? '+' : ''}${formatNumber(productionDifference)} ${selectedAnalytics.unit}` : '—',
      helper: !selectedAnalytics
        ? 'Comparison unavailable'
        : selectedAnalytics.differencePercent === null
          ? 'No output baseline yesterday'
          : `${Math.abs(selectedAnalytics.differencePercent).toFixed(1)}% ${productionDifference > 0 ? 'higher' : productionDifference < 0 ? 'lower' : 'change'}`,
      icon: productionDifference < 0 ? TrendingDown : TrendingUp,
      tone: productionDifference > 0 ? 'success' : productionDifference < 0 ? 'warning' : 'neutral',
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
    void overviewQuery.refetch()
    setLiveRefresh((current) => current + 1)
    void chartQuery.refetch()
  }

  const controls = (
      <div className="overview-controls-card">
        <div className="overview-meta-strip">
          <span className="overview-meta-item">
            <Factory size={16} aria-hidden="true" />

            <strong>{hasCurrentLive && liveData.machine ? (liveData.machine.name || 'Spiral Mill 01') : 'Spiral Mill 01'}</strong>
          </span>
          <span className="overview-meta-item">
            <CircleCheck size={16} aria-hidden="true" />

            <strong>{hasCurrentLive ? `${reportingSensorCount} / 5 reporting` : 'Reporting unavailable'}</strong>
          </span>
          <span className="overview-meta-item">
            <Clock3 size={16} aria-hidden="true" />

            <strong>{hasCurrentLive && liveLastUpdated ? formatSuccessfulUpdate(liveLastUpdated) : 'Not synced'}</strong>
          </span>
        </div>
        <button
          className="btn btn-secondary overview-refresh-button"
          type="button"
          aria-label="Refresh overview data"
          disabled={isUnifiedRefreshing}
          onClick={handleUnifiedRefresh}
        >
          <RotateCw className={isUnifiedRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>
  )
  const headerSlot = document.getElementById('overview-header-controls')

  return (
    <div className="overview-layout">
      {headerSlot ? createPortal(controls, headerSlot) : controls}

      {overviewDisplayState === 'loading' && !hasCurrentOverview ? <OverviewLoadingState /> : null}

      {overviewDisplayState === 'stale' ? <div className="notice notice-error" role="alert">Overview data is stale. {overviewQuery.dataUpdatedAt ? `Last updated ${formatSuccessfulUpdate(new Date(overviewQuery.dataUpdatedAt))}. ` : ''}{overviewError} <button type="button" onClick={() => overviewQuery.refetch()}>Retry overview</button></div> : null}
      {overviewDisplayState === 'error' ? (
        <section className="section-card section-placeholder" aria-labelledby="overview-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Overview unavailable</p>
            <h2 id="overview-error-title">Unable to load dashboard overview</h2>
            <p role="alert">{overviewError}</p>
            <button className="btn btn-secondary" type="button" onClick={() => overviewQuery.refetch()}>
              Retry overview
            </button>
          </div>
        </section>
      ) : null}

      {overviewDisplayState === 'empty' && hasCurrentOverview ? <OverviewEmptyState /> : null}

      {overviewAlerts.length > 0 || fallbackSensorFaultBanner || processIdleBanner ? (
        <div className="alerts-stack">
          {overviewAlerts.length > 0 ? (
            (() => {
              const primaryAlert = overviewAlerts[0]
              const extraCount = overviewAlerts.length - 1
              return (
                <div
                  className={`notice dashboard-alert overview-alert-banner ${isDangerOverviewAlert(primaryAlert) ? 'notice-error' : ''}`}
                  role="alert"
                >
                  <div className="overview-alert-lead">
                    <AlertTriangle size={16} aria-hidden="true" className="overview-alert-icon" />
                    <span className="overview-alert-message">{getOverviewAlertMessage(primaryAlert)}</span>
                  </div>
                  {extraCount > 0 ? <span className="overview-alert-count">+{extraCount} more unresolved alert{extraCount > 1 ? 's' : ''}</span> : null}
                  {overviewAlertDestinations.map((destination) => (
                    <Link
                      key={destination.to}
                      to={destination.to}
                      className="overview-alert-more-link"
                      aria-label={destination.label}
                    >
                      <span className="overview-alert-action-label">{destination.label}</span>
                      <MoveRight size={13} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              )
            })()
          ) : fallbackSensorFaultBanner ? (
            <div className="notice dashboard-alert overview-alert-banner notice-error" role="alert">
              <div className="overview-alert-lead">
                <AlertTriangle size={16} aria-hidden="true" className="overview-alert-icon" />
                <span className="overview-alert-message">{fallbackSensorFaultBanner.message}</span>
              </div>
              {fallbackSensorFaultBanner.extraCount > 0 ? (
                <span className="overview-alert-count">
                  +{fallbackSensorFaultBanner.extraCount} more faulted sensor{fallbackSensorFaultBanner.extraCount > 1 ? 's' : ''}
                </span>
              ) : null}
              <Link
                to={fallbackSensorFaultBanner.isDowntime ? '/dashboard/downtime' : '/dashboard/live'}
                className="overview-alert-more-link"
                aria-label={fallbackSensorFaultBanner.isDowntime ? 'View downtime records' : 'View live sensor status'}
              >
                <span className="overview-alert-action-label">
                  {fallbackSensorFaultBanner.isDowntime ? 'View downtime records' : 'View live sensor status'}
                </span>
                <MoveRight size={13} aria-hidden="true" />
              </Link>
            </div>
          ) : null}

          {processIdleBanner ? (
            <div
              className="notice dashboard-alert overview-alert-banner notice-idle"
              role="status"
              aria-live="polite"
            >
              <div className="overview-alert-lead">
                <PauseCircle size={16} aria-hidden="true" className="overview-alert-icon" />
                <span className="overview-alert-message">{processIdleBanner.message}</span>
              </div>
              {processIdleBanner.extraCount > 0 ? (
                <details className="overview-idle-details">
                  <summary>+{processIdleBanner.extraCount} more idle sensor{processIdleBanner.extraCount > 1 ? 's' : ''}</summary>
                  {processIdleBanner.sensors.slice(1).map((sensor) => (
                    <div key={sensor.sensorCode}>{sensor.sensorCode} {sensor.label}</div>
                  ))}
                </details>
              ) : null}
              <Link
                to="/dashboard/live"
                className="overview-alert-more-link"
                aria-label="View live sensor status"
              >
                <span className="overview-alert-action-label">View live sensor status</span>
                <MoveRight size={13} aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {overviewIsReady ? <div className="kpi-grid">
        {kpiItems.map((item) => {
          const Icon = item.icon
          return (
            <article key={item.id} className={`section-card stat-card stat-card-${item.tone}`}>
              <div className="stat-card-heading">
                <span className="stat-card-icon" aria-hidden="true">
                  <Icon size={15} />
                </span>
                <p className="stat-label">{item.label}</p>
              </div>
              <p className="stat-value">{item.value}</p>
            </article>
          )
        })}
      </div> : null}

      <div className="overview-charts-grid">
        {overviewIsReady ? (
          <ProductionAnalytics analytics={overviewData.productionAnalytics} />
        ) : overviewDisplayState === 'loading' && !hasCurrentOverview ? (
          <ProductionAnalyticsSkeleton />
        ) : null}

        <section className="section-card downtime-chart-card">
          <div className="section-heading">
            <div>
              {chartDisplayState === 'loading' && !hasLoadedInitialChart ? (
                <SkeletonBlock className="skeleton-heading" />
              ) : (
                <h2>Downtime by Period</h2>
              )}
            </div>
            {chartDisplayState === 'loading' && !hasLoadedInitialChart ? (
              <div className="trend-controls-skeleton" aria-hidden="true">
                <SkeletonBlock className="skeleton-control" />
              </div>
            ) : (
              <div className="trend-controls" aria-label="Downtime chart controls">
                <TrendCalendarControl
                  mode={trendMode}
                  selectedDate={trendAnchorDate}
                  maxDate={today}
                  rangeLabel={trendRangeLabel}
                  onDateChange={setTrendAnchorDate}
                  onModeChange={setTrendMode}
                  triggerAriaLabel={`Selected period ${trendRangeLabel}`}
                  triggerLabel=""
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
              <button className="btn btn-secondary table-action-button" type="button" onClick={() => chartQuery.refetch()}>
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
              <button className="btn btn-secondary table-action-button" type="button" onClick={() => chartQuery.refetch()}>
                Retry chart
              </button>
            </div>
          ) : chartDisplayState === 'loading' && !hasCurrentDowntimeChart ? (
            <DowntimeChartSkeleton />
          ) : trendData.length > 0 ? (
            <DowntimeTrendChart
              data={trendData}
              thresholdMinutes={downtimeImpact?.thresholdMinutes || 30}
              lossEstimateBasis={downtimeImpact?.lossEstimateBasis || null}
            />
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
        <section className="machine-health-card" aria-labelledby="machine-health-title">
          <div className="section-heading">
            <div>
              <h2 id="machine-health-title">Machine Health · {liveData.machine?.name || 'Spiral Mill 01'}</h2>
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
                {' '}(updated <UpdatedAgo updatedAt={liveLastUpdated} />). {liveError}
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
                  <span>{sensor.code}</span>
                  <span className={`status-badge ${getLiveStatusClass(sensor.status)}`}>{sensor.status === 'Fault' ? <Wrench size={12} aria-hidden="true" /> : null}{sensor.status}</span>
                </div>
                <h3 title={sensor.label}>{sensor.label}</h3>
                <div className="overview-sensor-footer">
                  <span>{sensor.lastEventAt ? formatLiveDateTime(sensor.lastEventAt) : 'No recent event'}</span>
                  <span>Connection: {connectivityLabel(sensor)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
