import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import { formatShortDateTime } from '../../../shared/utils/formatters.js'
import { getDowntimeStatusClass } from '../../../shared/utils/statusClasses.js'
import { getDowntimeRecords, subscribeToDowntime, updateDowntimeRecord } from './downtimeService.js'

const statusFilters = ['All', 'Open', 'Resolved']
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

function getRecordLabel(record) {
  const sensorName = record.sensorLabel || (record.sensor ? formatSensorName(record.sensor) : 'selected sensor')
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
  const canEditDowntime = downtimeEditRoles.has(user?.role)
  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState({ open: 0, resolved: 0, minutes: 0, loss: 0 })
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false })
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('All')
  const [causeFilter, setCauseFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState(getManilaDateInputValue)
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [updatingRecordId, setUpdatingRecordId] = useState('')
  const [expandedRecordId, setExpandedRecordId] = useState('')
  const [draftNotes, setDraftNotes] = useState({})

  const loadDowntimeRecords = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setIsLoading(true)
      setNotice(null)
    }

    try {
      const payload = await getDowntimeRecords(token, {
        status: statusFilter,
        cause: causeFilter,
        date: dateFilter,
        page,
        limit: 25,
      })
      setRecords(payload.records || [])
      setSummary(payload.summary || { open: 0, resolved: 0, minutes: 0, loss: 0 })
      setPagination(payload.pagination || { page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false })
      if (!silent) {
        setExpandedRecordId('')
        setDraftNotes({})
      }
    } catch (error) {
      if (!silent) {
        setNotice({ type: 'error', message: error.message || 'Unable to load downtime records.' })
        setRecords([])
        setSummary({ open: 0, resolved: 0, minutes: 0, loss: 0 })
        setPagination({ page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false })
      }
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [causeFilter, dateFilter, page, statusFilter, token])
  const loadDowntimeRecordsRef = useRef(loadDowntimeRecords)
  loadDowntimeRecordsRef.current = loadDowntimeRecords

  useEffect(() => {
    loadDowntimeRecords()
  }, [loadDowntimeRecords])

  useEffect(() => {
    if (!token) return undefined

    let pollingId = null

    function startFallbackPolling() {
      if (pollingId !== null) return
      pollingId = window.setInterval(() => {
        void loadDowntimeRecordsRef.current({ silent: true })
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
        void loadDowntimeRecordsRef.current({ silent: true })
      },
      onFallback: startFallbackPolling,
      onRecovery: stopFallbackPolling,
    })

    return () => {
      unsubscribe()
      stopFallbackPolling()
    }
  }, [token])

  async function updateCause(recordId, cause) {
    setUpdatingRecordId(recordId)
    setNotice(null)

    try {
      const payload = await updateDowntimeRecord(token, recordId, { cause })
      setRecords((current) => current.map((record) => (record.id === payload.record.id ? payload.record : record)))
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
      setRecords((current) => current.map((record) => (record.id === payload.record.id ? payload.record : record)))
      setNotice({ type: 'success', message: `${getRecordLabel(payload.record)} notes saved.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to update downtime notes.' })
    } finally {
      setUpdatingRecordId('')
    }
  }

  async function resolveRecord(recordId) {
    setUpdatingRecordId(recordId)
    setNotice(null)

    try {
      const payload = await updateDowntimeRecord(token, recordId, { status: 'Resolved' })
      setRecords((current) => current.map((record) => (record.id === payload.record.id ? payload.record : record)))
      setNotice({ type: 'success', message: `${getRecordLabel(payload.record)} downtime resolved.` })
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to resolve downtime record.' })
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

  return (
    <div className="downtime-layout">
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
          <p className="stat-label">Resolved Today</p>
          <p className="stat-value">{summary.resolved}</p>
          <p className="stat-helper">Today only</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">Total Downtime</p>
          <p className="stat-value">{summary.minutes} min</p>
          <p className="stat-helper">Today only</p>
        </article>
        <article className="section-card stat-card">
          <p className="stat-label">Estimated Loss</p>
          <p className="stat-value">{summary.loss} pcs</p>
          <p className="stat-helper">Based on downtime duration</p>
        </article>
      </div>

      <section className="section-card downtime-controls-card" aria-label="Downtime filters">
        <div className="trend-mode-toggle" role="group" aria-label="Filter downtime by status">
          {statusFilters.map((status) => (
            <button
              key={status}
              className={`trend-mode-button ${statusFilter === status ? 'is-selected' : ''}`}
              type="button"
              aria-pressed={statusFilter === status}
              onClick={() => {
                setStatusFilter(status)
                setPage(1)
              }}
            >
              {status}
            </button>
          ))}
        </div>
        <label className="filter-field" htmlFor="downtime-cause-filter">
          <span>Cause</span>
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
        <label className="filter-field" htmlFor="downtime-date-filter">
          <span>Date</span>
          <input
            id="downtime-date-filter"
            name="downtimeDate"
            type="date"
            value={dateFilter}
            onChange={(event) => {
              setDateFilter(event.target.value)
              setPage(1)
            }}
            autoComplete="off"
          />
        </label>
      </section>

      <section className="section-card downtime-table-card" aria-labelledby="downtime-records-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Event records</p>
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
                      <td data-label="Machine/Sensor">{record.machine}<br /><span className="table-muted">{record.sensorLabel || formatSensorName(record.sensor)}</span></td>
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
                        {canEditDowntime ? (
                          <button
                            className="btn btn-secondary table-action-button table-action-activate"
                            type="button"
                            disabled={record.status === 'Resolved' || updatingRecordId === record.id}
                            onClick={() => resolveRecord(record.id)}
                          >
                            <CheckCircle2 size={16} aria-hidden="true" />
                            {updatingRecordId === record.id ? 'Saving' : 'Resolve'}
                          </button>
                        ) : <span className="table-muted">Read only</span>}
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
                                  <dd>{record.sensorLabel || formatSensorName(record.sensor)}</dd>
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
