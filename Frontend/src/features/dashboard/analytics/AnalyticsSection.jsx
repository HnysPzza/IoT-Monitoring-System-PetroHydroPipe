import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Info, RotateCw } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getAnalyticsKpis, secondaryAnalyticsKpiIds } from './analyticsPresentation.js'
import { getAnalyticsSnapshot, getManilaDateInputValue, resolveAnalyticsRange } from './analyticsService.js'
import AnalyticsOperationsDetails from './AnalyticsOperationsDetails.jsx'
import AnalyticsDateRangePicker from './AnalyticsDateRangePicker.jsx'
import AnalyticsTrendExplorer from './AnalyticsTrendExplorer.jsx'
import AnalyticsKpiCard from './AnalyticsKpiCard.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'

const AUTO_REFRESH_MS = 60 * 1000

const rangePresets = [
  { id: 'this-week', label: 'This week' },
  { id: 'this-month', label: 'This month' },
  { id: 'all', label: 'All time' },
]

function addDateDays(dateValue, amount) {
  const date = new Date(`${dateValue}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
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
  const { token } = useAuth()
  const currentManilaDate = useMemo(() => getManilaDateInputValue(), [])
  const [period, setPeriod] = useState('this-week')
  const [customStartDate, setCustomStartDate] = useState(() => addDateDays(currentManilaDate, -6))
  const [customEndDate, setCustomEndDate] = useState(currentManilaDate)
  const [trendMetric, setTrendMetric] = useState('downtime')
  const [isCaveatOpen, setIsCaveatOpen] = useState(false)
  const [snapshot, setSnapshot] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const requestIdRef = useRef(0)
  const requestControllerRef = useRef(null)
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
    ? `${token || 'anonymous'}:${range.period}:${range.range || range.startDate}:${range.endDate || ''}:${range.bucket}`
    : ''

  const loadSnapshot = useCallback(async () => {
    if (!range) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    requestControllerRef.current?.abort()
    const requestController = new AbortController()
    requestControllerRef.current = requestController
    const previousResult = successfulSnapshotRef.current
    const hasMatchingSnapshot = previousResult?.requestKey === requestKey

    if (!hasMatchingSnapshot) setSnapshot(null)
    setLoadState(hasMatchingSnapshot ? 'refreshing' : 'loading')
    setErrorMessage('')

    try {
      const nextSnapshot = await loadAnalytics(token, requestOptions, { signal: requestController.signal })
      if (requestId !== requestIdRef.current) return

      successfulSnapshotRef.current = { requestKey, snapshot: nextSnapshot }
      setSnapshot(nextSnapshot)
      setLoadState('success')
    } catch (error) {
      if (requestId !== requestIdRef.current) return

      const nextErrorMessage = error?.message || 'Unable to load Analytics.'
      setErrorMessage(nextErrorMessage)

      if (hasMatchingSnapshot) {
        setSnapshot(previousResult.snapshot)
        setLoadState('stale')
      } else {
        setSnapshot(null)
        setLoadState('error')
      }
    } finally {
      if (requestId === requestIdRef.current) requestControllerRef.current = null
    }
  }, [loadAnalytics, range, requestKey, requestOptions, token])

  useEffect(() => {
    if (!range) {
      // A delayed API response must not overwrite validation after
      // a user has made the custom range invalid.
      requestIdRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
      setSnapshot(null)
      setErrorMessage('')
      setLoadState('validation')
      return
    }

    loadSnapshot()
  }, [loadSnapshot, range])

  useEffect(() => {
    if (!range) return undefined

    const intervalId = window.setInterval(loadSnapshot, AUTO_REFRESH_MS)
    return () => window.clearInterval(intervalId)
  }, [loadSnapshot, range])

  useEffect(() => () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  const isInitialLoading = loadState === 'loading' && !snapshot
  const kpis = snapshot ? getAnalyticsKpis(snapshot) : []
  const primaryKpis = kpis.filter((kpi) => kpi.isPrimary)
  const secondaryKpis = kpis.filter((kpi) => secondaryAnalyticsKpiIds.includes(kpi.id))
  const coverageMessage = snapshot?.coverage?.message || 'Metrics use recorded system events and downtime records. Historical heartbeat completeness is not available.'

  const handleCustomDateRangeChange = useCallback(({ startDate, endDate }) => {
    setCustomStartDate(startDate)
    setCustomEndDate(endDate)
    setPeriod('custom')
  }, [])

  return (
    <div className="reports-layout analytics-layout">
      <section className="section-card analytics-controls-card" aria-labelledby="analytics-controls-title">
        <div className="analytics-header-row">
          <div className="analytics-title-group">
            <h2 id="analytics-controls-title">Analytics</h2>
            <Popover open={isCaveatOpen} onOpenChange={setIsCaveatOpen}>
              <PopoverTrigger asChild>
                <button
                  className="analytics-info-trigger"
                  type="button"
                  aria-label="Analytics data coverage information"
                  aria-haspopup="dialog"
                  aria-expanded={isCaveatOpen}
                >
                  <Info size={16} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="analytics-caveat-popover" aria-label="Analytics data coverage information">
                {coverageMessage}
              </PopoverContent>
            </Popover>
          </div>

          <div className="analytics-header-controls">
            <fieldset className="analytics-range-fieldset">
              <legend className="sr-only">Date range</legend>
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
            <AnalyticsDateRangePicker
              startDate={customStartDate}
              endDate={customEndDate}
              maxDate={currentManilaDate}
              onChange={handleCustomDateRangeChange}
              isActive={period === 'custom'}
            />
            <button
              className="btn analytics-refresh-button"
              type="button"
              aria-label="Refresh data"
              disabled={!range || loadState === 'loading' || loadState === 'refreshing'}
              onClick={loadSnapshot}
            >
              <RotateCw className={loadState === 'refreshing' ? 'spin-icon' : ''} size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      {loadState === 'refreshing' ? (
        <div className="notice dashboard-alert" role="status" aria-live="polite">
          <RotateCw className="spin-icon" size={16} aria-hidden="true" />
          <span>Refreshing Analytics...</span>
        </div>
      ) : null}

      {loadState === 'stale' ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Showing the last recorded result because refresh failed. {errorMessage}</span>
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
        <section className="section-card" aria-label="Loading Analytics">
          <div className="notice dashboard-alert" role="status" aria-live="polite">
            <RotateCw className="spin-icon" size={16} aria-hidden="true" />
            <span>Loading Analytics...</span>
          </div>
          <div className="skeleton skeleton-panel" />
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="section-card section-placeholder" aria-labelledby="analytics-error-title">
          <div className="section-copy">
            <h2 id="analytics-error-title">Unable to load Analytics</h2>
            <p role="alert">{errorMessage}</p>
            <button className="btn btn-secondary" type="button" onClick={loadSnapshot}>
              Retry
            </button>
          </div>
        </section>
      ) : null}

      {snapshot && range && loadState !== 'error' && loadState !== 'validation' ? (
        <>
          <section className="analytics-kpi-grid analytics-primary-kpi-grid" aria-label="Primary Analytics summary">
            {primaryKpis.map((kpi) => (
              <AnalyticsKpiCard
                key={kpi.id}
                kpi={kpi}
                selectedMetric={trendMetric}
                onSelect={setTrendMetric}
              />
            ))}
          </section>

          <section className="analytics-secondary-kpi-row" aria-label="Secondary Analytics summary">
            {secondaryKpis.map((kpi) => (
              <AnalyticsKpiCard
                key={kpi.id}
                kpi={kpi}
                selectedMetric={trendMetric}
                onSelect={setTrendMetric}
              />
            ))}
          </section>

          <AnalyticsTrendExplorer
            snapshot={snapshot}
            metricId={trendMetric}
            onMetricChange={setTrendMetric}
          />
          <AnalyticsOperationsDetails snapshot={snapshot} />
        </>
      ) : null}
    </div>
  )
}
