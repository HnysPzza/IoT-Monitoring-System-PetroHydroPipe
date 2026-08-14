import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Boxes, CalendarDays, Clock3, Database, Gauge, RotateCw } from 'lucide-react'
import { getAnalyticsKpis } from './analyticsPresentation.js'
import { getAnalyticsSnapshot, resolveAnalyticsRange } from './analyticsService.js'
import AnalyticsTrendExplorer from './AnalyticsTrendExplorer.jsx'

const rangePresets = [
  { id: 'this-week', label: 'This week' },
  { id: 'this-month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
]

const kpiIcons = {
  downtime: Clock3,
  availability: Gauge,
  production: Boxes,
  'process-events': Activity,
}

function hasAnalyticsRecords(snapshot) {
  return Boolean(
    snapshot?.downtimeEvents?.length
    || snapshot?.processEvents?.length
    || snapshot?.productionRecords?.length,
  )
}

function getRangeValidation(options) {
  try {
    return { range: resolveAnalyticsRange(options), errorMessage: '' }
  } catch (error) {
    return {
      range: null,
      errorMessage: error?.message || 'Choose a valid Analytics date range.',
    }
  }
}

export default function AnalyticsSection({ loadAnalytics = getAnalyticsSnapshot }) {
  const [period, setPeriod] = useState('this-week')
  const [customStartDate, setCustomStartDate] = useState('2026-08-10')
  const [customEndDate, setCustomEndDate] = useState('2026-08-14')
  const [trendMetric, setTrendMetric] = useState('downtime')
  const [snapshot, setSnapshot] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const requestIdRef = useRef(0)
  const successfulSnapshotRef = useRef(null)

  const requestOptions = useMemo(() => (
    period === 'custom'
      ? { period, startDate: customStartDate, endDate: customEndDate }
      : { period }
  ), [customEndDate, customStartDate, period])
  const { range, errorMessage: rangeErrorMessage } = useMemo(
    () => getRangeValidation(requestOptions),
    [requestOptions],
  )
  const requestKey = range
    ? `${range.period}:${range.startDate}:${range.endDate}:${range.bucket}`
    : ''

  const loadSnapshot = useCallback(async () => {
    if (!range) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const previousResult = successfulSnapshotRef.current
    const hasMatchingSnapshot = previousResult?.requestKey === requestKey

    if (!hasMatchingSnapshot) setSnapshot(null)
    setLoadState(hasMatchingSnapshot ? 'refreshing' : 'loading')
    setErrorMessage('')

    try {
      const nextSnapshot = await loadAnalytics(requestOptions)
      if (requestId !== requestIdRef.current) return

      successfulSnapshotRef.current = { requestKey, snapshot: nextSnapshot }
      setSnapshot(nextSnapshot)
      setLoadState('success')
    } catch (error) {
      if (requestId !== requestIdRef.current) return

      const nextErrorMessage = error?.message || 'Unable to prepare the local Analytics preview.'
      setErrorMessage(nextErrorMessage)

      if (hasMatchingSnapshot) {
        setSnapshot(previousResult.snapshot)
        setLoadState('stale')
      } else {
        setSnapshot(null)
        setLoadState('error')
      }
    }
  }, [loadAnalytics, range, requestKey, requestOptions])

  useEffect(() => {
    if (!range) {
      // A delayed local adapter must not overwrite the validation state after
      // a user has made the custom range invalid.
      requestIdRef.current += 1
      setSnapshot(null)
      setErrorMessage('')
      setLoadState('validation')
      return
    }

    loadSnapshot()
  }, [loadSnapshot, range])

  const isInitialLoading = loadState === 'loading' && !snapshot
  const isEmpty = snapshot && !hasAnalyticsRecords(snapshot)
  const kpis = snapshot ? getAnalyticsKpis(snapshot) : []

  return (
    <div className="reports-layout analytics-layout">
      <section className="section-card analytics-controls-card" aria-labelledby="analytics-controls-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Analytics workspace</p>
            <h2 id="analytics-controls-title">Local Analytics preview</h2>
          </div>
          <span className="section-chip">
            <Database size={16} aria-hidden="true" />
            Local fixture only
          </span>
        </div>

        <p className="analytics-intro-copy">
          This frontend preview uses deterministic local data for Spiral Mill 01. It has no Analytics backend connection.
        </p>

        <div className="analytics-filter-row">
          <fieldset className="analytics-range-fieldset">
            <legend>Date range</legend>
            <div className="trend-mode-toggle analytics-range-toggle" role="group" aria-label="Analytics date range">
              {rangePresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`trend-mode-button ${period === preset.id ? 'is-selected' : ''}`}
                  type="button"
                  aria-pressed={period === preset.id}
                  onClick={() => setPeriod(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </fieldset>

          {period === 'custom' ? (
            <div className="analytics-custom-dates">
              <label className="filter-field" htmlFor="analytics-start-date">
                <span>Start date</span>
                <input
                  id="analytics-start-date"
                  type="date"
                  value={customStartDate}
                  onChange={(event) => setCustomStartDate(event.target.value)}
                />
              </label>
              <label className="filter-field" htmlFor="analytics-end-date">
                <span>End date</span>
                <input
                  id="analytics-end-date"
                  type="date"
                  value={customEndDate}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          <div className="analytics-bucket-summary" aria-live="polite">
            <CalendarDays size={17} aria-hidden="true" />
            <span>Automatic aggregation</span>
            <strong>{range?.bucket || 'Fix dates'}</strong>
          </div>

          <button
            className="btn btn-secondary analytics-refresh-button"
            type="button"
            disabled={!range || loadState === 'loading' || loadState === 'refreshing'}
            onClick={loadSnapshot}
          >
            <RotateCw className={loadState === 'refreshing' ? 'spin-icon' : ''} size={17} aria-hidden="true" />
            Refresh local data
          </button>
        </div>

        {range ? (
          <p className="analytics-range-copy">
            Showing {range.startDate} to {range.endDate} in {snapshot?.timeZone || 'Asia/Manila'} time.
          </p>
        ) : null}
      </section>

      {loadState === 'refreshing' ? (
        <div className="notice dashboard-alert" role="status" aria-live="polite">
          <RotateCw className="spin-icon" size={16} aria-hidden="true" />
          <span>Refreshing local Analytics preview...</span>
        </div>
      ) : null}

      {loadState === 'stale' ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Showing the last local preview because refresh failed. {errorMessage}</span>
          <button className="btn btn-secondary table-action-button" type="button" onClick={loadSnapshot}>
            Retry
          </button>
        </div>
      ) : null}

      {loadState === 'validation' ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{rangeErrorMessage} Fix the selected dates before refreshing Analytics.</span>
        </div>
      ) : null}

      {isInitialLoading ? (
        <section className="section-card" aria-label="Loading Analytics preview">
          <div className="notice dashboard-alert" role="status" aria-live="polite">
            <RotateCw className="spin-icon" size={16} aria-hidden="true" />
            <span>Loading Analytics workspace...</span>
          </div>
          <div className="skeleton skeleton-panel" />
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="section-card section-placeholder" aria-labelledby="analytics-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Analytics preview unavailable</p>
            <h2 id="analytics-error-title">Unable to prepare Analytics</h2>
            <p role="alert">{errorMessage}</p>
            <button className="btn btn-secondary" type="button" onClick={loadSnapshot}>
              Retry
            </button>
          </div>
        </section>
      ) : null}

      {snapshot && range && loadState !== 'error' && loadState !== 'validation' ? (
        isEmpty ? (
          <section className="section-card section-placeholder" aria-labelledby="analytics-empty-title">
            <div className="section-copy">
              <p className="section-eyebrow">No local records</p>
              <h2 id="analytics-empty-title">No Analytics data in this range</h2>
              <p>No local Analytics records fall inside this preview range.</p>
            </div>
          </section>
        ) : (
          <>
            <section className="analytics-kpi-grid" aria-label="Analytics summary">
              {kpis.map((kpi) => {
                const Icon = kpiIcons[kpi.id]

                return (
                  <article key={kpi.id} className="section-card analytics-kpi-card">
                    <div className="analytics-kpi-heading">
                      <p className="stat-label">{kpi.label}</p>
                      <Icon size={18} aria-hidden="true" />
                    </div>
                    <p className="stat-value">{kpi.value}</p>
                    <p className="stat-helper">{kpi.helper}</p>
                  </article>
                )
              })}
            </section>

            <AnalyticsTrendExplorer
              snapshot={snapshot}
              metricId={trendMetric}
              onMetricChange={setTrendMetric}
            />
          </>
        )
      ) : null}
    </div>
  )
}
