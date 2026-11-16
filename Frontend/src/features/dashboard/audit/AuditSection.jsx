import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, History, RotateCw, X } from 'lucide-react'
import { keepPreviousData } from '@tanstack/react-query'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import TrendCalendarControl from '../overview/TrendCalendarControl.jsx'
import { getAuditLogs } from './auditService.js'
import {
  auditActionGroups,
  auditEntityOptions,
  filterableAuditActions,
  formatDateTime,
  getAuditTone,
  getReadableAction,
  getReadableDetails,
  getReadableDetailItems,
  getReadableEntity,
  getReadableTarget,
  isEntityAllowedForAction,
} from './auditFormatters.js'
import './audit.css'

const AUDIT_PAGE_SIZE = 25
const AUDIT_MODES = new Set(['day', 'week', 'month', 'custom'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SKELETON_ROW_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6']

function parseAuditDate(value) {
  if (!value || !ISO_DATE_RE.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return undefined
  }
  return parsed
}

function formatAuditDateInput(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatAuditDateLabel(date) {
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getManilaDateInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function clampAuditDateEnd(endDateStr, maxDateStr) {
  return endDateStr > maxDateStr ? maxDateStr : endDateStr
}

function readAuditSearchState(searchParams) {
  const action = searchParams.get('action') || 'All'
  const entityType = searchParams.get('entity') || 'All'
  const rawMode = searchParams.get('mode') || 'day'
  const mode = AUDIT_MODES.has(rawMode) ? rawMode : 'day'
  const rawFrom = searchParams.get('dateFrom') || ''
  const rawTo = searchParams.get('dateTo') || ''
  const dateFrom = parseAuditDate(rawFrom) ? rawFrom : ''
  const dateTo = parseAuditDate(rawTo) ? rawTo : dateFrom
  const rawPage = Number.parseInt(searchParams.get('page') || '1', 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1

  return { action, entityType, mode, dateFrom, dateTo, page }
}

function formatRangeSummaryLabel(dateFrom, dateTo, mode) {
  const start = parseAuditDate(dateFrom)
  const end = parseAuditDate(dateTo)
  if (!start) return ''
  if (mode === 'month') {
    return start.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  }
  if ((mode === 'week' || mode === 'custom') && end) {
    return `${formatAuditDateLabel(start)} - ${formatAuditDateLabel(end)}`
  }
  return formatAuditDateLabel(start)
}

function formatVisibleRowRange(pagination) {
  if (!pagination.total) return ''
  const start = (pagination.page - 1) * pagination.limit + 1
  const end = Math.min(pagination.total, start + pagination.limit - 1)
  return `Showing ${start}–${end} of ${pagination.total}`
}

export default function AuditSection() {
  const online = useNetworkOnline()
  const [searchParams, setSearchParams] = useSearchParams()
  const detailsDialogRef = useRef(null)
  const actionSelectRef = useRef(null)
  const dateFieldRef = useRef(null)
  const historyCardRef = useRef(null)
  const lastTriggerRef = useRef(null)
  const skipReturnFocusRef = useRef(false)
  const manualRefreshRef = useRef(false)
  const seenIdsRef = useRef(new Set())
  const prevFilterSignatureRef = useRef('')

  const [selectedLog, setSelectedLog] = useState(null)
  const [returnedLogId, setReturnedLogId] = useState(null)
  const [arrivedIds, setArrivedIds] = useState(() => new Set())
  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  const {
    action: actionFilter,
    entityType: entityFilter,
    mode: urlMode,
    dateFrom,
    dateTo,
    page,
  } = readAuditSearchState(searchParams)
  const [draftMode, setDraftMode] = useState(urlMode)

  useEffect(() => {
    setDraftMode(urlMode)
  }, [urlMode])

  const filters = {
    action: actionFilter,
    entityType: entityFilter,
    date: dateFrom,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: AUDIT_PAGE_SIZE,
  }

  const query = useAuthenticatedQuery({
    queryKey: queryKeys.audit.list(filters),
    queryFn: ({ token, signal }) => getAuditLogs(token, filters, { signal }),
    staleTime: 30000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })

  const logs = useMemo(() => query.data?.logs || [], [query.data?.logs])
  const pagination = query.data?.pagination || {
    page,
    limit: AUDIT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: page > 1,
  }
  const hasData = Boolean(query.data)
  const isLoading = online && query.isPending && !hasData
  const isRefreshing = query.isFetching && hasData
  const isColdFailure = !hasData && (query.isError || !online)

  const filterSignature = `${actionFilter}|${entityFilter}|${dateFrom}|${dateTo}|${page}`

  // Highlight newly polled rows while avoiding false highlights on initial load or filter switches.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return

    if (prevFilterSignatureRef.current !== filterSignature) {
      prevFilterSignatureRef.current = filterSignature
      seenIdsRef.current = new Set(logs.map((entry) => entry.id))
      setArrivedIds(new Set())
      return
    }

    const nextIds = new Set(logs.map((entry) => entry.id))
    const newlyArrived = logs
      .filter((entry) => !seenIdsRef.current.has(entry.id))
      .map((entry) => entry.id)

    seenIdsRef.current = nextIds
    if (newlyArrived.length > 0) {
      setArrivedIds(new Set(newlyArrived))
    }
  }, [filterSignature, logs, query.data, query.isPlaceholderData])

  // Clear new-row highlight after the arrival animation finishes.
  useEffect(() => {
    if (arrivedIds.size === 0) return undefined
    const timer = window.setTimeout(() => setArrivedIds(new Set()), 2100)
    return () => window.clearTimeout(timer)
  }, [arrivedIds])

  // Clear row return highlight shortly after dialog focus settles.
  useEffect(() => {
    if (!returnedLogId) return undefined
    const timer = window.setTimeout(() => setReturnedLogId(null), 750)
    return () => window.clearTimeout(timer)
  }, [returnedLogId])

  // Announce manual refresh outcomes once the active fetch finishes.
  useEffect(() => {
    if (!manualRefreshRef.current || query.isFetching) return
    manualRefreshRef.current = false
    setLiveAnnouncement(
      query.isError
        ? 'Audit log refresh failed.'
        : `Audit log refreshed. Showing page ${pagination.page} of ${pagination.totalPages}.`,
    )
  }, [pagination.page, pagination.totalPages, query.isError, query.isFetching])

  const notice = hasData && (query.isError || !online)
    ? {
      type: 'error',
      message: `Audit data is stale.${query.isPlaceholderData ? ' Showing previous filter results.' : ''}${query.dataUpdatedAt ? ` Last updated ${new Date(query.dataUpdatedAt).toLocaleString()}.` : ''} ${query.error?.message || 'Unable to refresh while offline.'}`,
    }
    : null

  function commitSearchState(overrides) {
    const next = {
      action: overrides.action ?? actionFilter,
      entityType: overrides.entityType ?? entityFilter,
      mode: overrides.mode ?? draftMode,
      dateFrom: overrides.dateFrom ?? dateFrom,
      dateTo: overrides.dateTo ?? dateTo,
      page: overrides.page ?? page,
    }
    const nextParams = new URLSearchParams()
    if (next.action && next.action !== 'All') nextParams.set('action', next.action)
    if (next.entityType && next.entityType !== 'All') nextParams.set('entity', next.entityType)
    if (next.dateFrom) {
      nextParams.set('dateFrom', next.dateFrom)
      nextParams.set('dateTo', next.dateTo || next.dateFrom)
      if (next.mode && next.mode !== 'day') nextParams.set('mode', next.mode)
    }
    if (next.page > 1) nextParams.set('page', String(next.page))
    setSearchParams(nextParams)
  }

  function updateActionFilter(value) {
    const nextEntityType = isEntityAllowedForAction(value, entityFilter) ? entityFilter : 'All'
    commitSearchState({ action: value, entityType: nextEntityType, page: 1 })
  }

  function updateEntityFilter(value) {
    commitSearchState({ entityType: value, page: 1 })
  }

  function goToPage(nextPage) {
    const clampedPage = Math.max(1, nextPage)
    commitSearchState({ page: clampedPage })
    setLiveAnnouncement(`Loading page ${clampedPage}.`)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    historyCardRef.current?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }

  function handleModeChange(nextMode) {
    setDraftMode(nextMode)
  }

  function handleAuditDateChange(date) {
    if (!date) {
      setDraftMode('day')
      commitSearchState({ mode: 'day', dateFrom: '', dateTo: '', page: 1 })
      return
    }

    const todayStr = getManilaDateInputValue()
    let startStr
    let endStr
    let nextMode = draftMode === 'custom' ? 'day' : draftMode

    if (nextMode === 'month') {
      const start = new Date(date.getFullYear(), date.getMonth(), 1)
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
      startStr = clampAuditDateEnd(formatAuditDateInput(start), todayStr)
      endStr = clampAuditDateEnd(formatAuditDateInput(end), todayStr)
    } else if (nextMode === 'week') {
      const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      monday.setDate(monday.getDate() - (monday.getDay() || 7) + 1)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      startStr = clampAuditDateEnd(formatAuditDateInput(monday), todayStr)
      endStr = clampAuditDateEnd(formatAuditDateInput(sunday), todayStr)
    } else {
      nextMode = 'day'
      const dateStr = clampAuditDateEnd(formatAuditDateInput(date), todayStr)
      startStr = dateStr
      endStr = dateStr
    }

    setDraftMode(nextMode)
    commitSearchState({ mode: nextMode, dateFrom: startStr, dateTo: endStr, page: 1 })
  }

  function handleAuditRangeChange(range) {
    if (!range?.startDate || !range?.endDate) return
    const todayStr = getManilaDateInputValue()
    const startStr = clampAuditDateEnd(formatAuditDateInput(range.startDate), todayStr)
    const endStr = clampAuditDateEnd(formatAuditDateInput(range.endDate), todayStr)
    setDraftMode('custom')
    commitSearchState({ mode: 'custom', dateFrom: startStr, dateTo: endStr, page: 1 })
  }

  function clearDateFilter() {
    setDraftMode('day')
    commitSearchState({ mode: 'day', dateFrom: '', dateTo: '', page: 1 })
    const triggerButton = dateFieldRef.current?.querySelector('.trend-calendar-trigger')
    triggerButton?.focus({ preventScroll: true })
  }

  function resetAllFilters() {
    setDraftMode('day')
    commitSearchState({ action: 'All', entityType: 'All', mode: 'day', dateFrom: '', dateTo: '', page: 1 })
    actionSelectRef.current?.focus({ preventScroll: true })
  }

  function openDetails(log, triggerElement) {
    skipReturnFocusRef.current = false
    lastTriggerRef.current = triggerElement || null
    setSelectedLog(log)
    detailsDialogRef.current?.showModal()
  }

  function closeDetails() {
    detailsDialogRef.current?.close()
  }

  function filterByModalAction(action) {
    skipReturnFocusRef.current = true
    closeDetails()
    updateActionFilter(action)
    actionSelectRef.current?.focus({ preventScroll: true })
  }

  function handleDialogClose() {
    const closedId = selectedLog?.id || null
    const skipReturnFocus = skipReturnFocusRef.current
    skipReturnFocusRef.current = false
    setSelectedLog(null)
    if (skipReturnFocus) return
    if (closedId) {
      setReturnedLogId(closedId)
    }
    const triggerButton = lastTriggerRef.current
    if (triggerButton?.isConnected) {
      triggerButton.focus({ preventScroll: true })
    }
  }

  const maxAuditDate = parseAuditDate(getManilaDateInputValue())
  const selectedAuditDate = parseAuditDate(dateFrom)
  const selectedAuditRange = dateFrom && dateTo
    ? { startDate: parseAuditDate(dateFrom), endDate: parseAuditDate(dateTo) }
    : undefined
  const auditRangeLabel = formatRangeSummaryLabel(dateFrom, dateTo, urlMode)
  const hasAnyFilter = actionFilter !== 'All' || entityFilter !== 'All' || Boolean(dateFrom)
  const isLegacySelectedAction = actionFilter !== 'All' && !filterableAuditActions.has(actionFilter)
  const refreshButtonTitle = !online
    ? 'Offline — reconnect to refresh'
    : (isRefreshing ? 'Refreshing audit log...' : 'Refresh audit log')

  const totalChipText = isColdFailure ? 'Unavailable' : `${pagination.total} total`
  const visibleRangeText = formatVisibleRowRange(pagination)

  return (
    <div className="audit-layout">
      <div className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</div>
      <header className="audit-page-header">
        <h1 id="audit-title" className="audit-page-title">Audit log</h1>
        <p className="audit-page-subtitle">Recorded user, machine, sensor, and security activity.</p>
      </header>

      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{notice.message}</span>
          <button
            className="btn btn-secondary audit-notice-retry"
            type="button"
            disabled={!online || isRefreshing}
            onClick={() => query.refetch()}
          >
            Retry
          </button>
        </div>
      ) : null}

      <section className="section-card audit-controls-card" aria-label="Audit filters">
        <div className="audit-controls">
          <label className="filter-field" htmlFor="audit-action-filter">
            <span>Activity</span>
            <div className="custom-select-wrap">
              <select
                ref={actionSelectRef}
                id="audit-action-filter"
                name="auditAction"
                value={actionFilter}
                onChange={(event) => updateActionFilter(event.target.value)}
                autoComplete="off"
              >
                <option value="All">All actions</option>
                {isLegacySelectedAction ? (
                  <option value={actionFilter}>{getReadableAction({ action: actionFilter })}</option>
                ) : null}
                {auditActionGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown className="select-chevron-icon" size={16} aria-hidden="true" />
            </div>
          </label>

          <label className="filter-field" htmlFor="audit-entity-filter">
            <span>Area</span>
            <div className="custom-select-wrap">
              <select
                id="audit-entity-filter"
                name="auditEntity"
                value={entityFilter}
                onChange={(event) => updateEntityFilter(event.target.value)}
                autoComplete="off"
              >
                {auditEntityOptions.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.value !== 'All' && !isEntityAllowedForAction(actionFilter, option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="select-chevron-icon" size={16} aria-hidden="true" />
            </div>
          </label>

          <div ref={dateFieldRef} className="filter-field audit-date-field">
            <span>Date</span>
            <TrendCalendarControl
              mode={draftMode}
              accessibleLabel="Select audit date"
              triggerLabel=""
              triggerAriaLabel={`Select audit date: ${auditRangeLabel || 'Any date'}`}
              selectedDate={selectedAuditDate}
              selectedRange={selectedAuditRange}
              maxDate={maxAuditDate}
              rangeLabel={auditRangeLabel || 'Any date'}
              enableCustomRange
              canClear={Boolean(dateFrom)}
              onClear={clearDateFilter}
              onDateChange={handleAuditDateChange}
              onRangeChange={handleAuditRangeChange}
              onModeChange={handleModeChange}
            />
          </div>

          <div className="audit-controls-actions">
            {hasAnyFilter ? (
              <button
                className="btn btn-secondary audit-reset-button"
                type="button"
                onClick={resetAllFilters}
              >
                Reset filters
              </button>
            ) : null}
            {dateFrom ? (
              <button
                className="btn reports-icon-button audit-date-clear"
                type="button"
                aria-label="Clear date"
                title="Clear date"
                onClick={clearDateFilter}
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="btn reports-icon-button audit-refresh-button"
              type="button"
              aria-label="Refresh audit log"
              aria-busy={isRefreshing}
              title={refreshButtonTitle}
              disabled={!online || isRefreshing}
              onClick={() => {
                manualRefreshRef.current = true
                query.refetch()
              }}
            >
              <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <section ref={historyCardRef} className="section-card audit-history-card" aria-labelledby="audit-table-title">
        <div className="section-heading">
          <div className="audit-heading-group">
            <p className="section-eyebrow">Activity history</p>
            <h2 id="audit-table-title">Recent system actions</h2>
            <div className="audit-heading-meta">
              {!isColdFailure && hasData && pagination.total > 0 ? (
                <p className="table-muted">
                  Page {pagination.page} of {pagination.totalPages}, showing up to {pagination.limit} records per page.
                </p>
              ) : null}
              {isRefreshing ? (
                <span className="audit-refresh-status" role="status">
                  <RotateCw className="spin-icon" size={14} aria-hidden="true" />
                  <span>
                    {query.isPlaceholderData
                      ? 'Loading selected filters; previous results remain visible.'
                      : 'Refreshing audit log...'}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          <span className="section-chip audit-total-chip">
            <History size={14} aria-hidden="true" />
            {totalChipText}
          </span>
        </div>

        {isLoading ? (
          <div className="account-table-wrap" aria-busy="true" aria-label="Loading audit history">
            <table className="account-table audit-table">
              <thead>
                <tr>
                  <th scope="col">Date/Time</th>
                  <th scope="col">Action</th>
                  <th scope="col">Affected item</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {SKELETON_ROW_KEYS.map((key) => (
                  <tr key={key}>
                    <td data-label="Date/Time"><div className="skeleton audit-skeleton-cell is-medium" /></td>
                    <td data-label="Action"><div className="skeleton audit-skeleton-cell is-medium" /></td>
                    <td data-label="Affected item"><div className="skeleton audit-skeleton-cell is-short" /></td>
                    <td data-label="Summary"><div className="skeleton audit-skeleton-cell" /></td>
                    <td data-label="Details"><div className="skeleton audit-skeleton-cell is-short" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : isColdFailure ? (
          <div className="audit-empty-state" role="alert">
            <p className="audit-empty-title">Audit history could not be loaded.</p>
            <p className="audit-empty-copy">
              {!online
                ? 'Unable to refresh while offline. Reconnect to the network to load recorded activity.'
                : (query.error?.message || 'Unable to load audit records. Try refreshing in a moment.')}
            </p>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={!online || isRefreshing}
              onClick={() => query.refetch()}
            >
              Retry
            </button>
          </div>
        ) : logs.length === 0 ? (
          <div className="audit-empty-state" role="status">
            <p className="audit-empty-title">No audit records match the selected filters.</p>
            <p className="audit-empty-copy">
              {hasAnyFilter
                ? 'Try clearing one of your active filters or clicking Reset filters above to view older records.'
                : 'System and operator actions will appear here as activity is recorded.'}
            </p>
          </div>
        ) : (
          <>
            <div className="account-table-wrap">
              <table className="account-table audit-table">
                <thead>
                  <tr>
                    <th scope="col">Date/Time</th>
                    <th scope="col">Action</th>
                    <th scope="col">Affected item</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody className={query.isPlaceholderData && query.isFetching ? 'is-placeholder-fetching' : undefined}>
                  {logs.map((log) => {
                    const tone = getAuditTone(log)
                    const rowClasses = [
                      'audit-row',
                      arrivedIds.has(log.id) ? 'audit-row-arrived' : '',
                      returnedLogId === log.id ? 'audit-row-returned' : '',
                    ].filter(Boolean).join(' ')

                    return (
                      <tr key={log.id} className={rowClasses}>
                        <td className="audit-time-cell" data-label="Date/Time">
                          <time dateTime={log.createdAt || undefined}>{formatDateTime(log.createdAt)}</time>
                        </td>
                        <td data-label="Action">
                          <div className="audit-action-stack">
                            <span className="audit-action-badge" data-tone={tone}>
                              {getReadableAction(log)}
                            </span>
                            <span className="audit-entity-label">{getReadableEntity(log)}</span>
                          </div>
                        </td>
                        <td data-label="Affected item">{getReadableTarget(log)}</td>
                        <td className="audit-summary-cell" data-label="Summary">{getReadableDetails(log)}</td>
                        <td data-label="Details">
                          <button
                            className="btn btn-secondary table-action-button audit-details-button"
                            type="button"
                            onClick={(event) => openDetails(log, event.currentTarget)}
                          >
                            View details
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {pagination.total > 0 ? (
              <nav className="audit-pagination" aria-label="Audit pagination">
                <span className="audit-pagination-summary">
                  {visibleRangeText} · Page {pagination.page} of {pagination.totalPages}
                </span>
                <div className="audit-pagination-controls">
                  <button
                    className="btn btn-secondary audit-pagination-btn"
                    type="button"
                    aria-label="Previous page"
                    title="Previous page"
                    disabled={!online || isRefreshing || !pagination.hasPreviousPage || page <= 1}
                    onClick={() => goToPage(page - 1)}
                  >
                    <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  <button
                    className="btn btn-secondary audit-pagination-btn"
                    type="button"
                    aria-label="Next page"
                    title="Next page"
                    disabled={!online || isRefreshing || !pagination.hasNextPage}
                    onClick={() => goToPage(page + 1)}
                  >
                    <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              </nav>
            ) : null}
          </>
        )}
      </section>

      <dialog
        ref={detailsDialogRef}
        className="audit-details-dialog"
        aria-labelledby="audit-details-title"
        onClose={handleDialogClose}
        onClick={(event) => {
          if (event.target === detailsDialogRef.current) {
            closeDetails()
          }
        }}
      >
        {selectedLog ? (
          <div className="audit-dialog-content">
            <div className="audit-dialog-heading">
              <div className="audit-dialog-title-group">
                <span className="audit-action-badge" data-tone={getAuditTone(selectedLog)}>
                  {getReadableAction(selectedLog)}
                </span>
                <h2 id="audit-details-title">Audit details</h2>
              </div>
            </div>

            <dl className="audit-dialog-details">
              {getReadableDetailItems(selectedLog).map((item) => (
                <div
                  key={item.label}
                  className={[
                    'audit-detail-item',
                    item.emphasis === 'primary' ? 'audit-detail-primary' : '',
                    item.fullWidth ? 'audit-detail-full' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>

            <div className="audit-dialog-footer">
              {filterableAuditActions.has(selectedLog.action) && actionFilter !== selectedLog.action ? (
                <button
                  className="btn btn-secondary audit-dialog-filter-btn"
                  type="button"
                  onClick={() => filterByModalAction(selectedLog.action)}
                >
                  Filter by this action
                </button>
              ) : null}
              <button
                className="btn btn-secondary audit-dialog-close-btn"
                type="button"
                onClick={closeDetails}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  )
}
