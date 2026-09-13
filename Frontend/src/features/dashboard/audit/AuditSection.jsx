import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, RotateCw, X } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getAuditLogs } from './auditService.js'
import {
  auditActionOptions,
  auditEntityOptions,
  formatDateTime,
  getReadableAction,
  getReadableDetails,
  getReadableDetailItems,
  getReadableTarget,
} from './auditFormatters.js'

const AUDIT_PAGE_SIZE = 25

export default function AuditSection() {
  const { token } = useAuth()
  const detailsDialogRef = useRef(null)
  const [actionFilter, setActionFilter] = useState('All')
  const [entityFilter, setEntityFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: AUDIT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  })
  const [logs, setLogs] = useState([])
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedLog, setSelectedLog] = useState(null)

  async function loadAuditLogs({ silent = false } = {}) {
    if (silent) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    setNotice(null)

    try {
      const payload = await getAuditLogs(token, {
        action: actionFilter,
        entityType: entityFilter,
        date: dateFilter,
        page,
        limit: AUDIT_PAGE_SIZE,
      })

      setLogs(payload.logs || [])
      setPagination(payload.pagination || {
        page,
        limit: AUDIT_PAGE_SIZE,
        total: payload.logs?.length || 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: page > 1,
      })
      if (detailsDialogRef.current?.open) {
        detailsDialogRef.current.close()
      }
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Unable to load audit logs.' })
      setLogs([])
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    loadAuditLogs()
  }, [token, actionFilter, entityFilter, dateFilter, page])

  function updateActionFilter(value) {
    setActionFilter(value)
    setPage(1)
  }

  function updateEntityFilter(value) {
    setEntityFilter(value)
    setPage(1)
  }

  function updateDateFilter(value) {
    setDateFilter(value)
    setPage(1)
  }

  function openDetails(log) {
    setSelectedLog(log)
    detailsDialogRef.current?.showModal()
  }

  function closeDetails() {
    detailsDialogRef.current?.close()
  }

  return (
    <div className="audit-layout">
      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{notice.message}</span>
        </div>
      ) : null}

      <section className="section-card audit-controls-card" aria-labelledby="audit-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Accountability</p>
            <h2 id="audit-title">Audit log</h2>
          </div>
          <span className="section-chip">
            <History size={16} aria-hidden="true" />
            {pagination.total} total
          </span>
        </div>

        <div className="reports-controls">
          <label className="filter-field" htmlFor="audit-action-filter">
            <span>Activity</span>
            <select
              id="audit-action-filter"
              name="auditAction"
              value={actionFilter}
              onChange={(event) => updateActionFilter(event.target.value)}
              autoComplete="off"
            >
              {auditActionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field" htmlFor="audit-entity-filter">
            <span>Area</span>
            <select
              id="audit-entity-filter"
              name="auditEntity"
              value={entityFilter}
              onChange={(event) => updateEntityFilter(event.target.value)}
              autoComplete="off"
            >
              {auditEntityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field" htmlFor="audit-date-filter">
            <span>Date</span>
            <input
              id="audit-date-filter"
              name="auditDate"
              type="date"
              value={dateFilter}
              onChange={(event) => updateDateFilter(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="btn btn-success table-action-button audit-refresh-button" type="button" aria-label="Refresh audit log" disabled={isRefreshing} onClick={() => loadAuditLogs({ silent: true })}>
            <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </section>

      <section className="section-card" aria-labelledby="audit-table-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Activity history</p>
            <h2 id="audit-table-title">Recent system actions</h2>
            <p className="table-muted">Page {pagination.page} of {pagination.totalPages}, showing up to {pagination.limit} records per page.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="skeleton skeleton-panel" />
        ) : (
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
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="5">No audit records match the selected filters.</td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td><span className="audit-action-label">{getReadableAction(log)}</span></td>
                      <td>{getReadableTarget(log)}</td>
                      <td>{getReadableDetails(log)}</td>
                      <td>
                        <button
                          className="btn btn-secondary table-action-button audit-details-button"
                          type="button"
                          onClick={() => openDetails(log)}
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          <div className="audit-pagination" aria-label="Audit pagination">
            <button
              className="btn btn-secondary table-action-button"
              type="button"
              disabled={isLoading || isRefreshing || !pagination.hasPreviousPage}
              onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 1))}
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button
              className="btn btn-secondary table-action-button"
              type="button"
              disabled={isLoading || isRefreshing || !pagination.hasNextPage}
              onClick={() => setPage((currentPage) => currentPage + 1)}
            >
              Next
            </button>
          </div>
          </div>
        )}
      </section>

      <dialog
        ref={detailsDialogRef}
        className="audit-details-dialog"
        aria-labelledby="audit-details-title"
        aria-describedby="audit-details-description"
        onClose={() => setSelectedLog(null)}
      >
        {selectedLog ? (
          <div className="audit-dialog-content">
            <div className="audit-dialog-heading">
              <div>
                <p className="section-eyebrow">Activity summary</p>
                <h2 id="audit-details-title">Audit details</h2>
                <p id="audit-details-description">A clear summary of this activity.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close audit details" onClick={closeDetails}>
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <dl className="audit-dialog-details">
              {getReadableDetailItems(selectedLog).map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </dialog>
    </div>
  )
}
