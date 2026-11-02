import './analytics-compact.css'
import { createPortal } from 'react-dom'
import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { AlertTriangle, Info, RotateCw } from 'lucide-react'
import { getAnalyticsKpis } from './analyticsPresentation.js'
import { getAnalyticsSnapshot, getManilaDateInputValue, resolveAnalyticsRange } from './analyticsService.js'
import AnalyticsOperationsDetails from './AnalyticsOperationsDetails.jsx'
import AnalyticsDateRangePicker from './AnalyticsDateRangePicker.jsx'
import AnalyticsTrendExplorer from './AnalyticsTrendExplorer.jsx'
import AnalyticsKpiCard from './AnalyticsKpiCard.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'

const AUTO_REFRESH_MS = 60 * 1000

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
  const online = useNetworkOnline()
  const currentManilaDate = getManilaDateInputValue()
  const [period, setPeriod] = useState('week')
  const [selectedDate, setSelectedDate] = useState(currentManilaDate)
  const [customRange, setCustomRange] = useState(null)
  const [trendMetric, setTrendMetric] = useState('downtime')
  const [isCaveatOpen, setIsCaveatOpen] = useState(false)
  const requestOptions = useMemo(() => {
    if (period === 'all') {
      return { period: 'all' }
    }
    if (period === 'month') {
      return { period: 'this-month', referenceDate: selectedDate }
    }
    if (period === 'custom') {
      return {
        period: 'custom',
        startDate: customRange?.startDate || selectedDate,
        endDate: customRange?.endDate || selectedDate,
      }
    }
    return { period: 'this-week', referenceDate: selectedDate }
  }, [customRange, period, selectedDate])
  const { range, errorMessage: rangeErrorMessage } = useMemo(
    () => getRangeValidation(requestOptions),
    [requestOptions],
  )
  const query = useAuthenticatedQuery({
    queryKey: queryKeys.analytics.snapshot(range),
    queryFn: ({ token, signal }) => loadAnalytics(token, requestOptions, { signal }),
    enabled: Boolean(range),
    staleTime: 60000,
    refetchInterval: AUTO_REFRESH_MS,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })
  const snapshot = range ? query.data : null
  const loadState = !range ? 'validation' : query.isError || !online ? (snapshot ? 'stale' : 'error') : query.isFetching ? (snapshot ? 'refreshing' : 'loading') : 'success'
  const errorMessage = query.error?.message || (!online ? 'Unable to refresh while offline.' : 'Unable to load Analytics.')
  const loadSnapshot = () => query.refetch()
  const isInitialLoading = loadState === 'loading' && !snapshot
  const kpis = snapshot ? getAnalyticsKpis(snapshot) : []
  const hasComparison = snapshot?.comparisonMode !== 'none'
  const coverageMessage = snapshot?.coverage?.message || 'Metrics use recorded system events and downtime records. Historical heartbeat completeness is not available.'
  const isShowingPreviousRange = query.isPlaceholderData

  const handleRangeChange = useCallback(({ period: nextPeriod, startDate: nextStartDate, endDate: nextEndDate }) => {
    setPeriod(nextPeriod)
    if (nextPeriod === 'custom') {
      setCustomRange({ startDate: nextStartDate, endDate: nextEndDate })
    } else if (nextPeriod === 'week' || nextPeriod === 'month') {
      setSelectedDate(nextStartDate)
    }
  }, [])

  const controls = (
      <div className="analytics-controls-card">
        <div className="analytics-header-row">
          <div className="analytics-title-group">
            <h2 className="sr-only">Analytics</h2>
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
            <AnalyticsDateRangePicker
              period={period}
              startDate={range?.startDate}
              endDate={range?.endDate}
              maxDate={currentManilaDate}
              onChange={handleRangeChange}
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
      </div>
  )
  const headerSlot = document.getElementById('analytics-header-controls')

  return (
    <div className="reports-layout analytics-layout">
      {headerSlot ? createPortal(controls, headerSlot) : controls}

      {loadState === 'refreshing' ? (
        <div className="notice dashboard-alert" role="status" aria-live="polite">
          <RotateCw className="spin-icon" size={16} aria-hidden="true" />
          <span>{isShowingPreviousRange ? 'Loading selected period; previous results remain visible.' : 'Refreshing Analytics...'}</span>
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
          <section className="analytics-compact-kpis" aria-label="Analytics summary">
            {kpis.map((kpi) => (
              <AnalyticsKpiCard key={kpi.id} kpi={kpi} selectedMetric={trendMetric} onSelect={setTrendMetric} showComparison={hasComparison} />
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
