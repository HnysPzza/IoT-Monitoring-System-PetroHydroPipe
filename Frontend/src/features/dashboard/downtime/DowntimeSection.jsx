import './downtime.css'
import TrendCalendarControl from '../overview/TrendCalendarControl.jsx'
import { fromDateInputValue, toDateInputValue } from '../overview/DowntimeTrendChart.jsx'
import { Fragment, useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getDowntimeStatusClass } from '../../../shared/utils/statusClasses.js'
import { getDowntimeRecords, subscribeToDowntime, updateDowntimeRecord } from './downtimeService.js'

const editableDowntimeCauses = [
  'Corrective Maintenance',
  'Manual Cutting',
  'Misalignment',
  'Consumable Shortage',
  'Hydraulic Failure',
  'Electrical Failure',
  'Crane Failure',
  'Other',
]
const historicalDowntimeCauses = [
  ...editableDowntimeCauses,
  'Coil Joint',
  'Weld Wire Refill',
  'Flux Refill',
  'Pending Cause Review',
]
const downtimeEditRoles = new Set(['Admin', 'Operation Manager', 'Engineering Supervisor', 'Production Supervisor'])
const downtimeCalendarPresets = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'custom', label: 'Custom Range' },
]

function formatDowntimeDateLabel(date) {
  return date.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' })
}

function getWeekBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - (start.getDay() || 7) + 1)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start, end }
}

function getMonthBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { start, end }
}

function formatLossBasis(basis) {
  if (!basis) return 'Rate unavailable'
  const label = basis.source === 'trailing-7-days'
    ? 'Last 7 completed days'
    : basis.source === 'trailing-30-days'
      ? 'Last 30 completed days'
      : 'Configured fallback'
  return `${label}: ${Math.ceil(basis.ratePiecesPerMinute * 60)} pcs/hr`
}

function getSensorName(record) {
  if (!record.sensor) return record.sensorLabel || 'selected sensor'

  const canonicalName = formatSensorName(record.sensor)
  if (canonicalName !== record.sensor) return canonicalName
  if (!record.sensorLabel) return record.sensor
  return record.sensorLabel.startsWith(`${record.sensor} - `)
    ? record.sensorLabel
    : `${record.sensor} - ${record.sensorLabel}`
}

function getRecordLabel(record) {
  const sensorName = getSensorName(record)
  return `${record.machine || 'Machine'} / ${sensorName}`
}

function getDisplayLabel(record) {
  if (record.displayLabel) return record.displayLabel
  return record.sensor ? `${record.sensor} ${formatShortDateTime(record.startedAt)}` : formatShortDateTime(record.startedAt)
}

function getManilaDateInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default function DowntimeSection() {
  const { token, user } = useAuth()
  const [page, setPage] = useState(1)
  const [causeFilter, setCauseFilter] = useState('All')
  const [calendarMode, setCalendarMode] = useState('day')
  const [dateFilter, setDateFilter] = useState(getManilaDateInputValue)
  const [dateRange, setDateRange] = useState({ dateFrom: '', dateTo: '' })
  const [notice, setNotice] = useState(null)
  const [updatingRecordId, setUpdatingRecordId] = useState('')
  const [expandedRecordId, setExpandedRecordId] = useState('')
  const [draftNotes, setDraftNotes] = useState({})
  const queryClient = useQueryClient()
  const online = useNetworkOnline()
  const filters = dateRange.dateFrom && dateRange.dateTo
    ? { cause: causeFilter, date: dateFilter, dateFrom: dateRange.dateFrom, dateTo: dateRange.dateTo, page, limit: 25 }
    : { cause: causeFilter, date: dateFilter, page, limit: 25 }
  const query = useAuthenticatedQuery({
    queryKey: queryKeys.downtime.list(filters),
    queryFn: ({ token: currentToken, signal }) => getDowntimeRecords(currentToken, { ...filters, signal }),
    staleTime: 30000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })
  const canEditDowntime = downtimeEditRoles.has(user?.role) && !query.isPlaceholderData
  const records = query.data?.records || []
  const summary = query.data?.summary || { open: 0, resolved: 0, minutes: 0, loss: 0 }
  const lossEstimateBasis = query.data?.lossEstimateBasis || null
  const listRange = query.data?.range || null
  const pagination = query.data?.pagination || { page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
  const isLoading = query.isPending && !query.data
  const invalidate = async () => {
    await queryClient.cancelQueries({ queryKey: queryKeys.downtime.all })
    await queryClient.invalidateQueries({ queryKey: queryKeys.downtime.all })
    await queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all })
    await queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
    await queryClient.invalidateQueries({ queryKey: queryKeys.audit.all })
    await queryClient.invalidateQueries({ queryKey: queryKeys.overview.all })
  }
  const invalidateRef = useRef(invalidate)
  invalidateRef.current = invalidate

  useEffect(() => {
    if (!token) return undefined

    let pollingId = null
    let openReconciled = false

    function startFallbackPolling() {
      if (pollingId !== null) return
      pollingId = window.setInterval(() => {
        void invalidateRef.current()
      }, 10000)
    }

    function stopFallbackPolling() {
      if (pollingId === null) return
      window.clearInterval(pollingId)
      pollingId = null
    }

    const unsubscribe = subscribeToDowntime(token, {
      onEvent: (event) => {
        if (!event?.payload?.downtime) return
        void invalidateRef.current()
      },
      onFallback: startFallbackPolling,
      onOpen: ({ isReconnect, isRetry } = {}) => {
        openReconciled = isReconnect || isRetry
        if (openReconciled) void invalidateRef.current()
      },
      onRecovery: () => {
        stopFallbackPolling()
        if (!openReconciled) void invalidateRef.current()
        openReconciled = false
      },
    })
    const reconciliationId = window.setInterval(() => {
      void invalidateRef.current()
    }, 60000)

    return () => {
      unsubscribe()
      stopFallbackPolling()
      window.clearInterval(reconciliationId)
    }
  }, [token])

  async function updateCause(recordId, cause) {
    setUpdatingRecordId(recordId)
    setNotice(null)

    try {
      const payload = await updateDowntimeRecord(token, recordId, { cause })
      void invalidate()
      setNotice({ type: 'success', message: `${getRecordLabel(payload.record)} cause updated to ${payload.record.cause}.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to update downtime cause.' })
    } finally {
      setUpdatingRecordId('')
    }
  }

  async function saveNotes(recordId) {
    setUpdatingRecordId(recordId)
    setNotice(null)

    try {
      const payload = await updateDowntimeRecord(token, recordId, { notes: draftNotes[recordId] || '' })
      void invalidate()
      setNotice({ type: 'success', message: `${getRecordLabel(payload.record)} notes saved.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to update downtime notes.' })
    } finally {
      setUpdatingRecordId('')
    }
  }

  function toggleRecordDetails(record) {
    setExpandedRecordId((currentId) => {
      const nextId = currentId === record.id ? '' : record.id

      if (nextId) {
        setDraftNotes((currentDrafts) => ({
          ...currentDrafts,
          [record.id]: currentDrafts[record.id] ?? record.notes ?? '',
        }))
      }

      return nextId
    })
  }

  if (!online && !query.data) return <div role="alert">Unable to refresh while offline. <button type="button" onClick={() => query.refetch()}>Retry</button></div>

  const todayManila = getManilaDateInputValue()
  const maxDowntimeDate = fromDateInputValue(todayManila)
  const selectedDowntimeDate = dateFilter ? fromDateInputValue(dateFilter) : maxDowntimeDate
  const selectedCustomRange = dateRange.dateFrom && dateRange.dateTo
    ? { startDate: fromDateInputValue(dateRange.dateFrom), endDate: fromDateInputValue(dateRange.dateTo) }
    : { startDate: selectedDowntimeDate, endDate: selectedDowntimeDate }
  const isDefaultTodayView = calendarMode === 'day' && dateFilter === todayManila && !dateRange.dateFrom

  let downtimeRangeLabel = 'Last 30 days'
  if (dateFilter) {
    if (calendarMode === 'month') {
      const d = fromDateInputValue(dateRange.dateFrom || dateFilter)
      downtimeRangeLabel = d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
    } else if (calendarMode === 'week' || calendarMode === 'custom') {
      const start = fromDateInputValue(dateRange.dateFrom || dateFilter)
      const end = fromDateInputValue(dateRange.dateTo || dateFilter)
      downtimeRangeLabel = `${formatDowntimeDateLabel(start)} - ${formatDowntimeDateLabel(end)}`
    } else {
      downtimeRangeLabel = formatDowntimeDateLabel(selectedDowntimeDate)
    }
  }

  function handleDowntimeDateChange(date) {
    if (!date) return
    if (calendarMode === 'month') {
      const { start, end } = getMonthBounds(date)
      const startStr = toDateInputValue(start)
      const endStr = toDateInputValue(end > maxDowntimeDate ? maxDowntimeDate : end)
      setDateFilter(startStr)
      setDateRange({ dateFrom: startStr, dateTo: endStr })
    } else if (calendarMode === 'week') {
      const { start, end } = getWeekBounds(date)
      const startStr = toDateInputValue(start)
      const endStr = toDateInputValue(end > maxDowntimeDate ? maxDowntimeDate : end)
      setDateFilter(startStr)
      setDateRange({ dateFrom: startStr, dateTo: endStr })
    } else {
      const dateStr = toDateInputValue(date)
      setDateFilter(dateStr)
      setDateRange({ dateFrom: '', dateTo: '' })
    }
    setPage(1)
  }

  function handleDowntimeRangeChange({ startDate, endDate }) {
    if (!startDate || !endDate) return
    const startStr = toDateInputValue(startDate)
    const endStr = toDateInputValue(endDate > maxDowntimeDate ? maxDowntimeDate : endDate)
    setCalendarMode('custom')
    setDateFilter(startStr)
    setDateRange({ dateFrom: startStr, dateTo: endStr })
    setPage(1)
  }

  function clearDowntimeDate() {
    setDateFilter('')
    setDateRange({ dateFrom: '', dateTo: '' })
    setPage(1)
  }

  const periodHelperText = !dateFilter
    ? 'Last 30 days'
    : isDefaultTodayView
      ? 'Today only'
      : downtimeRangeLabel

  return (
    <div className="downtime-layout">
      {query.isFetching && query.data ? <div role="status">{query.isPlaceholderData ? 'Refreshing downtime records for the selected filters; previous results remain visible.' : 'Refreshing downtime records...'}</div> : null}
      {(query.isError || (!online && query.data)) ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          {query.data ? `Downtime data is stale.${query.isPlaceholderData ? ' Showing previous filter results.' : ''}${query.dataUpdatedAt ? ` Last updated ${new Date(query.dataUpdatedAt).toLocaleString()}.` : ''} ` : ''}{query.error?.message || 'Unable to refresh while offline.'} <button type="button" onClick={() => query.refetch()}>Retry</button>
        </div>
      ) : null}
      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      ) : null}

      <div className="kpi-grid">
        <article className="section-card stat-card">
          <p className="stat-label">Open Downtime</p>
          <p className="stat-value">{summary.open}</p>
          <p className="stat-helper">Requires review</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">{isDefaultTodayView ? 'Resolved Today' : 'Resolved'}</p>
          <p className="stat-value">{summary.resolved}</p>
          <p className="stat-helper">{periodHelperText}</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">Total Downtime</p>
          <p className="stat-value">{summary.minutes} min</p>
          <p className="stat-helper">{periodHelperText}</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">Estimated Loss</p>
          <p className="stat-value">{summary.loss} pcs</p>
          <p className="stat-helper">{formatLossBasis(lossEstimateBasis)}</p>
        </article>
      </div>

      <section className="section-card downtime-controls-card" aria-label="Downtime filters">
        <label className="filter-field" htmlFor="downtime-cause-filter">
          <span className="sr-only">Cause</span>
          <select
            id="downtime-cause-filter"
            name="downtimeCause"
            value={causeFilter}
            onChange={(event) => {
              setCauseFilter(event.target.value)
              setPage(1)
            }}
            autoComplete="off"
          >
            <option value="All">All causes</option>
            {historicalDowntimeCauses.map((cause) => (
              <option key={cause} value={cause}>{cause}</option>
            ))}
          </select>
        </label>
        <div className="downtime-date-control">
          <TrendCalendarControl
            mode={calendarMode}
            selectedDate={selectedDowntimeDate}
            selectedRange={selectedCustomRange}
            rangeLabel={downtimeRangeLabel}
            maxDate={maxDowntimeDate}
            popoverClassName="downtime-calendar-popover"
            triggerAriaLabel="Select downtime date"
            triggerLabel=""
            presets={downtimeCalendarPresets}
            onModeChange={setCalendarMode}
            onDateChange={handleDowntimeDateChange}
            onRangeChange={handleDowntimeRangeChange}
          />
          {dateFilter ? <button className="btn btn-secondary" type="button" onClick={clearDowntimeDate}>Clear date</button> : null}
        </div>
      </section>

      {listRange?.isDefault ? (
        <p className="stat-helper" role="status">Showing the last 30 days. Pick a date to see a single day.</p>
      ) : null}

      <section className="section-card downtime-table-card" aria-labelledby="downtime-records-title">
        <div className="section-heading">
          <div>
            <h2 id="downtime-records-title">Downtime records</h2>
          </div>
          <span className="section-chip">
            <TriangleAlert size={16} aria-hidden="true" />
            {records.length} shown
          </span>
        </div>

        {isLoading ? (
          <div className="skeleton skeleton-panel" />
        ) : (
          <div className="account-table-wrap">
          <table className="account-table downtime-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Machine/Sensor</th>
                <th scope="col">Cause</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">Details</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan="7">No downtime records match the selected filters.</td>
                </tr>
              ) : (
                records.map((record) => (
                  <Fragment key={record.id}>
                    <tr className={`${expandedRecordId === record.id ? 'is-expanded' : ''} ${record.needsCauseReview ? 'needs-cause-review' : ''}`}>
                      <td data-label="Event">
                        <span className="audit-action-label">{getDisplayLabel(record)}</span>
                        {record.needsCauseReview ? <span className="pending-review-chip">Needs cause review</span> : null}
                      </td>
                      <td data-label="Machine/Sensor">{record.machine}<br /><span className="table-muted">{getSensorName(record)}</span></td>
                      <td data-label="Cause">
                        {record.isCauseEditable ? (
                          <>
                            <label className="sr-only" htmlFor={`downtime-cause-${record.id}`}>Cause for {getDisplayLabel(record)}</label>
                            <select
                              id={`downtime-cause-${record.id}`}
                              name={`downtimeCause-${record.id}`}
                              className="inline-select"
                              value={record.cause}
                              disabled={!canEditDowntime || updatingRecordId === record.id}
                              onChange={(event) => updateCause(record.id, event.target.value)}
                              autoComplete="off"
                              title="Select downtime cause"
                            >
                              {!editableDowntimeCauses.includes(record.cause) ? (
                                <option value={record.cause} disabled>{record.cause}</option>
                              ) : null}
                              {editableDowntimeCauses.map((cause) => (
                                <option key={cause} value={cause}>{cause}</option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <span className="table-muted">{record.cause}</span>
                        )}
                      </td>
                      <td data-label="Duration">{record.durationMinutes} min</td>
                      <td data-label="Status"><span className={`status-badge ${getDowntimeStatusClass(record.status)}`}>{record.status}</span></td>
                      <td data-label="Details">
                        <button
                          className="btn btn-secondary table-action-button"
                          type="button"
                          aria-expanded={expandedRecordId === record.id}
                          aria-controls={`downtime-details-${record.id}`}
                          onClick={() => toggleRecordDetails(record)}
                        >
                          {expandedRecordId === record.id ? 'Hide details' : 'View details'}
                        </button>
                      </td>
                      <td data-label="Action">
                        <span className="table-muted">Sensor-managed</span>
                      </td>
                    </tr>
                    {expandedRecordId === record.id ? (
                      <tr className="audit-details-row downtime-details-row">
                        <td colSpan="7">
                          <div id={`downtime-details-${record.id}`} className="audit-details-panel downtime-details-panel">
                            <div>
                              <p className="audit-details-heading">Downtime review</p>
                              <dl className="audit-details-grid">
                                <div>
                                  <dt>What happened</dt>
                                  <dd>{getRecordLabel(record)} stopped for {record.durationMinutes} min.</dd>
                                </div>
                                <div>
                                  <dt>Machine</dt>
                                  <dd>{record.machine}</dd>
                                </div>
                                <div>
                                  <dt>Sensor</dt>
                                  <dd>{getSensorName(record)}</dd>
                                </div>
                                <div>
                                  <dt>Started</dt>
                                  <dd>{formatShortDateTime(record.startedAt)}</dd>
                                </div>
                                <div>
                                  <dt>Ended</dt>
                                  <dd>{formatShortDateTime(record.endedAt, 'Still open')}</dd>
                                </div>
                                <div>
                                  <dt>Cause rule</dt>
                                  <dd>
                                    {record.isCauseEditable
                                      ? 'Main sensor downtime needs manual cause review.'
                                      : 'Cause was assigned automatically from the sensor location.'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Estimated loss</dt>
                                  <dd>{record.estimatedLoss} pcs</dd>
                                </div>
                              </dl>
                            </div>
                            <label className="downtime-notes-editor" htmlFor={`downtime-notes-${record.id}`}>
                              <span>Review notes</span>
                              <textarea
                                id={`downtime-notes-${record.id}`}
                                name={`downtimeNotes-${record.id}`}
                                value={draftNotes[record.id] ?? record.notes ?? ''}
                                onChange={(event) => setDraftNotes((currentDrafts) => ({
                                  ...currentDrafts,
                                  [record.id]: event.target.value,
                                }))}
                                rows={3}
                                maxLength={1000}
                                disabled={!canEditDowntime || updatingRecordId === record.id}
                              />
                            </label>
                            {canEditDowntime ? <div className="downtime-detail-actions">
                              <button
                                className="btn btn-secondary table-action-button"
                                type="button"
                                disabled={updatingRecordId === record.id || (draftNotes[record.id] ?? record.notes ?? '') === (record.notes ?? '')}
                                onClick={() => saveNotes(record.id)}
                              >
                                {updatingRecordId === record.id ? 'Saving' : 'Save notes'}
                              </button>
                            </div> : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
        {pagination.totalPages > 1 ? (
          <nav className="table-pagination" aria-label="Downtime record pages">
            <button
              className="icon-button"
              type="button"
              aria-label="Previous downtime page"
              title="Previous page"
              disabled={!pagination.hasPreviousPage || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button
              className="icon-button"
              type="button"
              aria-label="Next downtime page"
              title="Next page"
              disabled={!pagination.hasNextPage || isLoading}
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </nav>
        ) : null}
      </section>
    </div>
  )
}
