import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, RotateCw, Search } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getAuditLogs } from './auditService.js'
import {
  auditActionOptions,
  auditEntityOptions,
  formatDateTime,
  getReadableAction,
  getReadableActor,
  getReadableDetails,
  getReadableEntity,
  getReadableSource,
  getReadableTarget,
} from './auditFormatters.js'

const AUDIT_PAGE_SIZE = 25

export default function AuditSection() {
  const { token } = useAuth()
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
  const [expandedLogId, setExpandedLogId] = useState(null)

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
      setExpandedLogId(null)
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
            <p className="section-eyebrow">Backend-backed</p>
            <h2 id="audit-title">Audit activity log</h2>
          </div>
          <span className="section-chip">
            <History size={16} aria-hidden="true" />
            {pagination.total} total
          </span>
        </div>

        <div className="reports-controls">
          <label className="filter-field" htmlFor="audit-action-filter">
            <span>Action type</span>
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
            <span>Entity type</span>
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
          <button className="btn btn-secondary table-action-button audit-refresh-button" type="button" disabled={isRefreshing} onClick={() => loadAuditLogs({ silent: true })}>
            <RotateCw className={isRefreshing ? 'spin-icon' : ''} size={16} aria-hidden="true" />
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </button>
          <div className="live-network-card audit-note">
            <Search size={17} aria-hidden="true" />
            <span>Audit rows are stored in Supabase and include actions from all roles plus system/device events.</span>
          </div>
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
                <th scope="col">Who did it</th>
                <th scope="col">Affected item</th>
                <th scope="col">Result / Details</th>
                <th scope="col">Source</th>
                <th scope="col">Technical</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="7">No audit records match the selected filters.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>
                      <span className="audit-action-label">{getReadableAction(log)}</span>
                      <span className="audit-entity-label">{getReadableEntity(log)}</span>
                    </td>
                    <td>{getReadableActor(log)}</td>
                    <td>{getReadableTarget(log)}</td>
                    <td>{getReadableDetails(log)}</td>
                    <td>{getReadableSource(log)}</td>
                    <td>
                      <button
                        className="btn btn-secondary table-action-button audit-details-button"
                        type="button"
                        aria-expanded={expandedLogId === log.id}
                        onClick={() => setExpandedLogId((currentId) => (currentId === log.id ? null : log.id))}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {expandedLogId ? (
            <div className="audit-technical-panel" aria-live="polite">
              {logs.filter((log) => log.id === expandedLogId).map((log) => (
                <div key={log.id}>
                  <p>Technical details</p>
                  <dl>
                    <div>
                      <dt>Log ID</dt>
                      <dd>{log.id}</dd>
                    </div>
                    <div>
                      <dt>Raw action</dt>
                      <dd>{log.action}</dd>
                    </div>
                    <div>
                      <dt>Entity type</dt>
                      <dd>{log.entityType}</dd>
                    </div>
                    <div>
                      <dt>Entity ID</dt>
                      <dd>{log.entityId || 'None'}</dd>
                    </div>
                    <div>
                      <dt>Metadata</dt>
                      <dd>{JSON.stringify(log.metadata || {}, null, 2)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          ) : null}
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
    </div>
  )
}
