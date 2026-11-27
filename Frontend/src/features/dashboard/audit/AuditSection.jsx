import { useEffect, useMemo, useRef, useState } from 'react'
import RefreshStatus from '../../../shared/components/RefreshStatus.jsx'
import { useSearchParams } from 'react-router'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, History, RotateCw, X } from 'lucide-react'
import { keepPreviousData } from '@tanstack/react-query'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import TrendCalendarControl from '../overview/TrendCalendarControl.jsx'
import { getProductionLogs } from '../production/productionService.js'
import { getAuditLogs } from './auditService.js'
import {
  auditActionGroups,
  auditEntityOptions,
  filterableAuditActions,
  formatDateTime,
  getAuditTone,
  getProductionLogCustomer,
  getProductionLogDetailItems,
  getProductionLogEvent,
  getProductionLogPipeLabel,
  getProductionLogSummary,
  getReadableAction,
  getReadableActor,
  getReadableDetails,
  getReadableDetailItems,
  getReadableEntity,
  getReadableTarget,
  isEntityAllowedForAction,
  PRODUCTION_CUT_STATUS_OPTIONS,
  PRODUCTION_SPEC_STATUS_OPTIONS,
} from './auditFormatters.js'
import './audit.css'

const AUDIT_PAGE_SIZE = 25
const AUDIT_MODES = new Set(['day', 'week', 'month', 'custom'])
const PRODUCTION_CUT_STATUSES = new Set(['all', 'accepted', 'rejected'])
const PRODUCTION_SPEC_STATUSES = new Set(['all', 'specified', 'unspecified'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SKELETON_ROW_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6']
const SYSTEM_COLUMNS = ['Date/Time', 'Action', 'Who did it', 'Affected item', 'Summary', 'Details']
const PRODUCTION_COLUMNS = ['Date/Time', 'Event', 'Pipe / Cut', 'Customer', 'Output summary', 'Details']

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
  const rawCutStatus = searchParams.get('cutStatus') || 'all'
  const cutStatus = PRODUCTION_CUT_STATUSES.has(rawCutStatus) ? rawCutStatus : 'all'
  const rawSpecStatus = searchParams.get('specStatus') || 'all'
  const specStatus = cutStatus === 'rejected' || !PRODUCTION_SPEC_STATUSES.has(rawSpecStatus) ? 'all' : rawSpecStatus
  const rawMode = searchParams.get('mode') || 'day'
  const mode = AUDIT_MODES.has(rawMode) ? rawMode : 'day'
  const rawFrom = searchParams.get('dateFrom') || ''
  const rawTo = searchParams.get('dateTo') || ''
  const dateFrom = parseAuditDate(rawFrom) ? rawFrom : ''
  const dateTo = dateFrom && parseAuditDate(rawTo) ? rawTo : dateFrom
  const rawPage = Number.parseInt(searchParams.get('page') || '1', 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1

  return { action, entityType, cutStatus, specStatus, mode, dateFrom, dateTo, page }
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
  const pageSize = pagination.limit || pagination.pageSize || AUDIT_PAGE_SIZE
  const start = (pagination.page - 1) * pageSize + 1
  const end = Math.min(pagination.total, start + pageSize - 1)
  return `Showing ${start}–${end} of ${pagination.total}`
}

export default function AuditSection({ loadProduction = getProductionLogs }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin'
  const online = useNetworkOnline()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = !isAdmin || searchParams.get('tab') === 'production' ? 'production' : 'system'
  const isProductionTab = activeTab === 'production'
  const detailsDialogRef = useRef(null)
  const primarySelectRef = useRef(null)
  const systemTabRef = useRef(null)
  const productionTabRef = useRef(null)
  const dateFieldRef = useRef(null)
  const historyCardRef = useRef(null)
  const lastTriggerRef = useRef(null)
  const skipReturnFocusRef = useRef(false)
  const manualRefreshRef = useRef(false)
  const seenIdsRef = useRef(new Set())
  const prevFilterSignatureRef = useRef('')

  const [selectedEntry, setSelectedEntry] = useState(null)
  const [returnedLogId, setReturnedLogId] = useState(null)
  const [arrivedIds, setArrivedIds] = useState(() => new Set())
  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  const {
    action: actionFilter,
    entityType: entityFilter,
    cutStatus,
    specStatus,
    mode: urlMode,
    dateFrom,
    dateTo,
    page,
  } = readAuditSearchState(searchParams)
  const [draftMode, setDraftMode] = useState(urlMode)

  useEffect(() => {
    setDraftMode(urlMode)
  }, [urlMode])

  const systemFilters = {
    action: actionFilter,
    entityType: entityFilter,
    date: dateFrom,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: AUDIT_PAGE_SIZE,
  }

  const isSingleDay = Boolean(dateFrom && (!dateTo || dateFrom === dateTo))
  const productionFilters = {
    date: isSingleDay ? dateFrom : undefined,
    dateFrom: !isSingleDay && dateFrom ? dateFrom : undefined,
    dateTo: !isSingleDay && dateTo ? dateTo : undefined,
    status: cutStatus,
    specStatus: cutStatus === 'rejected' ? 'all' : specStatus,
    page,
    pageSize: AUDIT_PAGE_SIZE,
  }

  const systemQuery = useAuthenticatedQuery({
    queryKey: queryKeys.audit.list(systemFilters),
    queryFn: ({ token, signal }) => getAuditLogs(token, systemFilters, { signal }),
    enabled: isAdmin && !isProductionTab,
    staleTime: 30000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })

  const productionQuery = useAuthenticatedQuery({
    queryKey: queryKeys.production.list(productionFilters),
    queryFn: ({ token, signal }) => loadProduction(token, { ...productionFilters, signal }),
    enabled: isProductionTab,
    staleTime: 30000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })

  const activeQuery = isProductionTab ? productionQuery : systemQuery
  const logs = useMemo(() => systemQuery.data?.logs || [], [systemQuery.data?.logs])
  const productionRecords = useMemo(() => productionQuery.data?.records || [], [productionQuery.data?.records])
  const rows = isProductionTab ? productionRecords : logs
  const rawPagination = activeQuery.data?.pagination
  const pagination = {
    page: rawPagination?.page || page,
    limit: rawPagination?.limit || rawPagination?.pageSize || AUDIT_PAGE_SIZE,
    total: rawPagination?.total ?? 0,
    totalPages: Math.max(1, rawPagination?.totalPages || 1),
    hasNextPage: Boolean(rawPagination?.hasNextPage),
    hasPreviousPage: rawPagination?.hasPreviousPage ?? page > 1,
  }
  const hasData = Boolean(activeQuery.data)
  const isLoading = online && activeQuery.isPending && !hasData
  const isRefreshing = activeQuery.isFetching && hasData
  const isColdFailure = !hasData && (activeQuery.isError || !online)

  const filterSignature = isProductionTab
    ? `production|${cutStatus}|${specStatus}|${dateFrom}|${dateTo}|${page}`
    : `system|${actionFilter}|${entityFilter}|${dateFrom}|${dateTo}|${page}`

  // Highlight newly polled rows while avoiding false highlights on initial load or filter switches.
  useEffect(() => {
    if (!activeQuery.data || activeQuery.isPlaceholderData) return

    const rowIds = rows.map((entry) => entry.id || entry.sensorEventId)
    if (prevFilterSignatureRef.current !== filterSignature) {
      prevFilterSignatureRef.current = filterSignature
      seenIdsRef.current = new Set(rowIds)
      setArrivedIds(new Set())
      return
    }

    const nextIds = new Set(rowIds)
    const newlyArrived = rowIds.filter((id) => !seenIdsRef.current.has(id))

    seenIdsRef.current = nextIds
    if (newlyArrived.length > 0) {
      setArrivedIds(new Set(newlyArrived))
    }
  }, [activeQuery.data, activeQuery.isPlaceholderData, filterSignature, rows])

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
    if (!manualRefreshRef.current || activeQuery.isFetching) return
    manualRefreshRef.current = false
    const subject = isProductionTab ? 'Production log' : 'Audit log'
    setLiveAnnouncement(
      activeQuery.isError
        ? `${subject} refresh failed.`
        : `${subject} refreshed. Showing page ${pagination.page} of ${pagination.totalPages}.`,
    )
  }, [activeQuery.isError, activeQuery.isFetching, isProductionTab, pagination.page, pagination.totalPages])

  const notice = hasData && (activeQuery.isError || !online)
    ? {
      type: 'error',
      message: `${isProductionTab ? 'Production log data is stale.' : 'Audit data is stale.'}${activeQuery.isPlaceholderData ? ' Showing previous filter results.' : ''}${activeQuery.dataUpdatedAt ? ` Last updated ${new Date(activeQuery.dataUpdatedAt).toLocaleString()}.` : ''} ${activeQuery.error?.message || 'Unable to refresh while offline.'}`,
    }
    : null

  function commitSearchState(overrides) {
    const nextTab = overrides.tab ?? activeTab
    const next = {
      action: overrides.action ?? actionFilter,
      entityType: overrides.entityType ?? entityFilter,
      cutStatus: overrides.cutStatus ?? cutStatus,
      specStatus: overrides.specStatus ?? specStatus,
      mode: overrides.mode ?? draftMode,
      dateFrom: overrides.dateFrom ?? dateFrom,
      dateTo: overrides.dateTo ?? dateTo,
      page: overrides.page ?? page,
    }
    const nextParams = new URLSearchParams()
    if (isAdmin && nextTab === 'production') {
      nextParams.set('tab', 'production')
    }
    if (nextTab === 'production') {
      if (next.cutStatus && next.cutStatus !== 'all') nextParams.set('cutStatus', next.cutStatus)
      if (next.cutStatus !== 'rejected' && next.specStatus && next.specStatus !== 'all') {
        nextParams.set('specStatus', next.specStatus)
      }
    } else {
      if (next.action && next.action !== 'All') nextParams.set('action', next.action)
      if (next.entityType && next.entityType !== 'All') nextParams.set('entity', next.entityType)
    }
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

  function updateCutStatusFilter(value) {
    const nextSpecStatus = value === 'rejected' ? 'all' : specStatus
    commitSearchState({ cutStatus: value, specStatus: nextSpecStatus, page: 1 })
  }

  function updateSpecStatusFilter(value) {
    commitSearchState({ specStatus: value, page: 1 })
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
    if (isProductionTab) {
      commitSearchState({ cutStatus: 'all', specStatus: 'all', mode: 'day', dateFrom: '', dateTo: '', page: 1 })
    } else {
      commitSearchState({ action: 'All', entityType: 'All', mode: 'day', dateFrom: '', dateTo: '', page: 1 })
    }
    primarySelectRef.current?.focus({ preventScroll: true })
  }

  function openDetails(entry, triggerElement) {
    skipReturnFocusRef.current = false
    lastTriggerRef.current = triggerElement || null
    setSelectedEntry(entry)
    detailsDialogRef.current?.showModal()
  }

  function closeDetails() {
    detailsDialogRef.current?.close()
  }

  function filterByModalAction(action) {
    skipReturnFocusRef.current = true
    closeDetails()
    updateActionFilter(action)
    primarySelectRef.current?.focus({ preventScroll: true })
  }

  function handleDialogClose() {
    const closedId = selectedEntry?.id || null
    const skipReturnFocus = skipReturnFocusRef.current
    skipReturnFocusRef.current = false
    setSelectedEntry(null)
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
  const hasAnyFilter = isProductionTab
    ? (cutStatus !== 'all' || specStatus !== 'all' || Boolean(dateFrom))
    : (actionFilter !== 'All' || entityFilter !== 'All' || Boolean(dateFrom))
  const isLegacySelectedAction = actionFilter !== 'All' && !filterableAuditActions.has(actionFilter)
  const refreshLabel = isProductionTab ? 'Refresh production log' : 'Refresh audit log'
  const refreshButtonTitle = !online
    ? 'Offline — reconnect to refresh'
    : (isRefreshing
      ? (isProductionTab ? 'Refreshing production log...' : 'Refreshing audit log...')
      : refreshLabel)

  const totalChipText = isColdFailure ? 'Unavailable' : `${pagination.total} total`
  const visibleRangeText = formatVisibleRowRange(pagination)
  const tableColumns = isProductionTab ? PRODUCTION_COLUMNS : SYSTEM_COLUMNS

  function switchTab(nextTab) {
    if (!isAdmin || nextTab === activeTab) return
    manualRefreshRef.current = false
    if (detailsDialogRef.current?.hasAttribute('open')) {
      skipReturnFocusRef.current = true
      closeDetails()
    } else {
      setSelectedEntry(null)
    }
    setReturnedLogId(null)
    commitSearchState({ tab: nextTab, page: 1 })
  }

  function handleTabKeyDown(event) {
    if (!isAdmin) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const nextTab = activeTab === 'system' ? 'production' : 'system'
      switchTab(nextTab)
      const targetRef = nextTab === 'production' ? productionTabRef : systemTabRef
      targetRef.current?.focus({ preventScroll: true })
    }
  }

  return (
    <div className="audit-layout">
      <div className="sr-only" role="status" aria-live="polite">{liveAnnouncement}</div>
      <header className="audit-page-header">
        <div className="audit-header-row">
          <div>
            <h1 id="audit-title" className="audit-page-title">{isAdmin ? 'Audit log' : 'Production log'}</h1>
            <p className="audit-page-subtitle">
              {isProductionTab
                ? 'Read-only chronological log of S-05 production cut events and recorded specifications.'
                : 'Recorded user, machine, sensor, and security activity.'}
            </p>
          </div>
          {isAdmin ? (
            <div
              className="audit-tabs"
              role="tablist"
              aria-label="Audit log views"
              data-active-tab={activeTab}
              onKeyDown={handleTabKeyDown}
            >
              <button
                ref={systemTabRef}
                type="button"
                id="audit-tab-system"
                role="tab"
                tabIndex={!isProductionTab ? 0 : -1}
                aria-selected={!isProductionTab}
                aria-controls="audit-tabpanel"
                className={`audit-tab-btn ${!isProductionTab ? 'is-active' : ''}`}
                onClick={() => switchTab('system')}
              >
                System Activity
              </button>
              <button
                ref={productionTabRef}
                type="button"
                id="audit-tab-production"
                role="tab"
                tabIndex={isProductionTab ? 0 : -1}
                aria-selected={isProductionTab}
                aria-controls="audit-tabpanel"
                className={`audit-tab-btn ${isProductionTab ? 'is-active' : ''}`}
                onClick={() => switchTab('production')}
              >
                Production Log
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div
        id={isAdmin ? 'audit-tabpanel' : undefined}
        role={isAdmin ? 'tabpanel' : undefined}
        aria-labelledby={isAdmin ? (isProductionTab ? 'audit-tab-production' : 'audit-tab-system') : undefined}
        className="audit-panel"
      >
        {notice ? (
          <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{notice.message}</span>
            <button
              className="btn btn-secondary audit-notice-retry"
              type="button"
              disabled={!online || isRefreshing}
              onClick={() => activeQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : null}

        <section className="section-card audit-controls-card" aria-label={isProductionTab ? 'Production log filters' : 'Audit filters'}>
          <div className="audit-controls">
            {isProductionTab ? (
              <>
                <label className="filter-field" htmlFor="production-log-status-filter">
                  <span>Cut status</span>
                  <div className="custom-select-wrap">
                    <select
                      ref={primarySelectRef}
                      id="production-log-status-filter"
                      name="productionCutStatus"
                      value={cutStatus}
                      onChange={(event) => updateCutStatusFilter(event.target.value)}
                      autoComplete="off"
                    >
                      {PRODUCTION_CUT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="select-chevron-icon" size={16} aria-hidden="true" />
                  </div>
                </label>

                <label className="filter-field" htmlFor="production-log-spec-filter">
                  <span>Specification</span>
                  <div className="custom-select-wrap">
                    <select
                      id="production-log-spec-filter"
                      name="productionSpecStatus"
                      value={specStatus}
                      disabled={cutStatus === 'rejected'}
                      onChange={(event) => updateSpecStatusFilter(event.target.value)}
                      autoComplete="off"
                    >
                      {PRODUCTION_SPEC_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="select-chevron-icon" size={16} aria-hidden="true" />
                  </div>
                </label>
              </>
            ) : (
              <>
                <label className="filter-field" htmlFor="audit-action-filter">
                  <span>Activity</span>
                  <div className="custom-select-wrap">
                    <select
                      ref={primarySelectRef}
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
              </>
            )}

            <div ref={dateFieldRef} className="filter-field audit-date-field">
              <span>Date</span>
              <TrendCalendarControl
                mode={draftMode}
                accessibleLabel={isProductionTab ? 'Select production log date' : 'Select audit date'}
                triggerLabel=""
                triggerAriaLabel={`${isProductionTab ? 'Select production log date' : 'Select audit date'}: ${auditRangeLabel || 'Any date'}`}
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
                aria-label={refreshLabel}
                aria-busy={isRefreshing}
                title={refreshButtonTitle}
                disabled={!online || isRefreshing}
                onClick={() => {
                  manualRefreshRef.current = true
                  activeQuery.refetch()
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
              <p className="section-eyebrow">{isProductionTab ? 'Production log' : 'Activity history'}</p>
              <h2 id="audit-table-title">{isProductionTab ? 'Recorded output cuts' : 'Recent system actions'}</h2>
              <div className="audit-heading-meta">
                {!isColdFailure && hasData && pagination.total > 0 ? (
                  <p className="table-muted">
                    Page {pagination.page} of {pagination.totalPages}, showing up to {pagination.limit} records per page.
                  </p>
                ) : null}
              </div>
            </div>
            <span className="section-chip audit-total-chip">
              <History size={14} aria-hidden="true" />
              {totalChipText}
            </span>
          </div>

          <RefreshStatus
            active={isRefreshing}
            isPlaceholder={activeQuery.isPlaceholderData}
            message={isProductionTab ? 'Refreshing production log...' : 'Refreshing audit log...'}
            placeholderMessage="Loading selected filters; previous results remain visible."
          />

          {isLoading ? (
            <div className="account-table-wrap" aria-busy="true" aria-label={isProductionTab ? 'Loading production log' : 'Loading audit history'}>
              <table className="account-table audit-table">
                <thead>
                  <tr>
                    {tableColumns.map((column) => (
                      <th key={column} scope="col">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SKELETON_ROW_KEYS.map((key) => (
                    <tr key={key}>
                      <td data-label={tableColumns[0]}><div className="skeleton audit-skeleton-cell is-medium" /></td>
                      <td data-label={tableColumns[1]}><div className="skeleton audit-skeleton-cell is-medium" /></td>
                      <td data-label={tableColumns[2]}><div className="skeleton audit-skeleton-cell is-short" /></td>
                      <td data-label={tableColumns[3]}><div className="skeleton audit-skeleton-cell is-short" /></td>
                      <td data-label={tableColumns[4]}><div className="skeleton audit-skeleton-cell" /></td>
                      <td data-label={tableColumns[5]}><div className="skeleton audit-skeleton-cell is-short" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : isColdFailure ? (
            <div className="audit-empty-state" role="alert">
              <p className="audit-empty-title">
                {isProductionTab ? 'Production log could not be loaded.' : 'Audit history could not be loaded.'}
              </p>
              <p className="audit-empty-copy">
                {!online
                  ? `Unable to refresh while offline. Reconnect to the network to load ${isProductionTab ? 'production log entries' : 'recorded activity'}.`
                  : (activeQuery.error?.message || `Unable to load ${isProductionTab ? 'production log records' : 'audit records'}. Try refreshing in a moment.`)}
              </p>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!online || isRefreshing}
                onClick={() => activeQuery.refetch()}
              >
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="audit-empty-state" role="status">
              <p className="audit-empty-title">
                {isProductionTab ? 'No production log entries match the selected filters.' : 'No audit records match the selected filters.'}
              </p>
              <p className="audit-empty-copy">
                {hasAnyFilter
                  ? 'Try clearing one of your active filters or clicking Reset filters above to view older records.'
                  : (isProductionTab
                    ? 'S-05 production cut events will appear here as output is recorded.'
                    : 'System and operator actions will appear here as activity is recorded.')}
              </p>
            </div>
          ) : (
            <>
              <div className="account-table-wrap">
                <table className="account-table audit-table">
                  <thead>
                    <tr>
                      {tableColumns.map((column) => (
                        <th key={column} scope="col">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={activeQuery.isPlaceholderData && activeQuery.isFetching ? 'is-placeholder-fetching' : undefined}>
                    {isProductionTab
                      ? productionRecords.map((record) => {
                        const rowId = record.id || record.sensorEventId
                        const eventMeta = getProductionLogEvent(record)
                        const rowClasses = [
                          'audit-row',
                          arrivedIds.has(rowId) ? 'audit-row-arrived' : '',
                          returnedLogId === rowId ? 'audit-row-returned' : '',
                        ].filter(Boolean).join(' ')

                        return (
                          <tr key={rowId} className={rowClasses}>
                            <td className="audit-time-cell" data-label="Date/Time">
                              <time dateTime={record.recordedAt || undefined}>{formatDateTime(record.recordedAt)}</time>
                            </td>
                            <td className="audit-action-cell" data-label="Event">
                              <div className="audit-action-stack">
                                <span className="audit-action-badge" data-tone={eventMeta.tone}>
                                  {eventMeta.label}
                                </span>
                                <span className="audit-entity-label">{eventMeta.sensorLabel}</span>
                              </div>
                            </td>
                            <td className="audit-actor-cell audit-pipe-cell" data-label="Pipe / Cut">
                              {getProductionLogPipeLabel(record)}
                            </td>
                            <td className="audit-target-cell" data-label="Customer">
                              {getProductionLogCustomer(record)}
                            </td>
                            <td className="audit-summary-cell" data-label="Output summary">
                              {getProductionLogSummary(record)}
                            </td>
                            <td data-label="Details">
                              <button
                                className="btn btn-secondary table-action-button audit-details-button"
                                type="button"
                                onClick={(event) => openDetails({ kind: 'production', id: rowId, record }, event.currentTarget)}
                              >
                                View details
                              </button>
                            </td>
                          </tr>
                        )
                      })
                      : logs.map((log) => {
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
                            <td className="audit-action-cell" data-label="Action">
                              <div className="audit-action-stack">
                                <span className="audit-action-badge" data-tone={tone}>
                                  {getReadableAction(log)}
                                </span>
                                <span className="audit-entity-label">{getReadableEntity(log)}</span>
                              </div>
                            </td>
                            <td className="audit-actor-cell" data-label="Who did it">{getReadableActor(log)}</td>
                            <td className="audit-target-cell" data-label="Affected item">{getReadableTarget(log)}</td>
                            <td className="audit-summary-cell" data-label="Summary">{getReadableDetails(log)}</td>
                            <td data-label="Details">
                              <button
                                className="btn btn-secondary table-action-button audit-details-button"
                                type="button"
                                onClick={(event) => openDetails({ kind: 'system', id: log.id, log }, event.currentTarget)}
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
                <nav className="audit-pagination" aria-label={isProductionTab ? 'Production log pagination' : 'Audit pagination'}>
                  <span className="audit-pagination-summary">
                    {visibleRangeText} · Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <div className="audit-pagination-controls">
                    <button
                      className="btn btn-secondary audit-pagination-btn"
                      type="button"
                      aria-label="Previous page"
                      title="Previous page"
                      disabled={!online || isRefreshing || !pagination.hasPreviousPage || pagination.page <= 1}
                      onClick={() => goToPage(pagination.page - 1)}
                    >
                      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <button
                      className="btn btn-secondary audit-pagination-btn"
                      type="button"
                      aria-label="Next page"
                      title="Next page"
                      disabled={!online || isRefreshing || !pagination.hasNextPage}
                      onClick={() => goToPage(pagination.page + 1)}
                    >
                      <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                </nav>
              ) : null}
            </>
          )}
        </section>
      </div>

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
        {selectedEntry ? (() => {
          const isProdEntry = selectedEntry.kind === 'production'
          const prodMeta = isProdEntry ? getProductionLogEvent(selectedEntry.record) : null
          const detailItems = isProdEntry
            ? getProductionLogDetailItems(selectedEntry.record)
            : getReadableDetailItems(selectedEntry.log)

          return (
            <div className="audit-dialog-content">
              <div className="audit-dialog-heading">
                <div className="audit-dialog-title-group">
                  <span
                    className="audit-action-badge"
                    data-tone={isProdEntry ? prodMeta.tone : getAuditTone(selectedEntry.log)}
                  >
                    {isProdEntry ? prodMeta.label : getReadableAction(selectedEntry.log)}
                  </span>
                  <h2 id="audit-details-title">
                    {isProdEntry ? 'Production log details' : 'Audit details'}
                  </h2>
                </div>
              </div>

              <dl className="audit-dialog-details">
                {detailItems.map((item) => (
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
                {!isProdEntry && filterableAuditActions.has(selectedEntry.log.action) && actionFilter !== selectedEntry.log.action ? (
                  <button
                    className="btn btn-secondary audit-dialog-filter-btn"
                    type="button"
                    onClick={() => filterByModalAction(selectedEntry.log.action)}
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
          )
        })() : null}
      </dialog>
    </div>
  )
}
