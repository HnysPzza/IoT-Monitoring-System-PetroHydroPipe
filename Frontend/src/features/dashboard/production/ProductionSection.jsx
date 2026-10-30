import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  RotateCw,
  Search,
  Tag,
} from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName, getSensorLabel } from '../../../shared/constants/sensorIdentity.js'
import { getProductionLogs } from './productionService.js'
import './ProductionSection.css'

export function getManilaDateInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function formatManilaDateTime(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(', ', ' ')
}

function formatDimension(value) {
  if (value === null || value === undefined || isNaN(Number(value))) return '—'
  return Number(value).toFixed(2)
}

export default function ProductionSection({ loadProduction = getProductionLogs }) {
  const { token } = useAuth()

  const [dateFilter, setDateFilter] = useState(getManilaDateInputValue)
  const [statusFilter, setStatusFilter] = useState('accepted')
  const [specStatusFilter, setSpecStatusFilter] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState({
    totalAccepted: 0,
    specifiedCount: 0,
    unspecifiedCount: 0,
    rejectedCount: 0,
  })
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  })

  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const requestIdRef = useRef(0)

  // Debounce search input changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const loadData = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++requestIdRef.current
    if (silent) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      const payload = await loadProduction(token, {
        date: dateFilter || undefined,
        status: statusFilter,
        specStatus: specStatusFilter,
        search: debouncedSearch || undefined,
        page,
        pageSize,
      })

      if (requestId !== requestIdRef.current) return

      setRecords(payload?.records || [])
      setSummary(
        payload?.summary || {
          totalAccepted: 0,
          specifiedCount: 0,
          unspecifiedCount: 0,
          rejectedCount: 0,
        },
      )
      setPagination(
        payload?.pagination || {
          page: 1,
          pageSize: 25,
          total: payload?.records?.length || 0,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      )
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      setError(err.message || 'Unable to load production logs.')
      if (!silent) {
        setRecords([])
        setSummary({
          totalAccepted: 0,
          specifiedCount: 0,
          unspecifiedCount: 0,
          rejectedCount: 0,
        })
        setPagination({
          page: 1,
          pageSize: 25,
          total: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        })
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [dateFilter, debouncedSearch, loadProduction, page, pageSize, specStatusFilter, statusFilter, token])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDateChange = (e) => {
    setDateFilter(e.target.value)
    setPage(1)
  }

  const handleStatusChange = (e) => {
    setStatusFilter(e.target.value)
    setPage(1)
  }

  const handleSpecStatusChange = (e) => {
    setSpecStatusFilter(e.target.value)
    setPage(1)
  }

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      setDebouncedSearch(searchInput.trim())
      setPage(1)
    }
  }

  const handlePreviousPage = () => {
    if (pagination.hasPreviousPage) {
      setPage((prev) => Math.max(1, prev - 1))
    }
  }

  const handleNextPage = () => {
    if (pagination.hasNextPage) {
      setPage((prev) => prev + 1)
    }
  }

  return (
    <div className="production-workspace">
      {/* Header Strip with Inline KPI counters */}
      <header className="production-header-strip">
        <div className="production-title-group">
          <p className="production-eyebrow">{formatSensorName('S-05')} · Spiral Mill 01</p>
          <h1 className="production-title">Production Logs</h1>
          <p className="production-subtitle">{getSensorLabel('S-05')} cuts and product specifications.</p>
        </div>

        <div className="production-kpi-strip" role="region" aria-label="Production Summary Metrics">
          <div className="production-kpi-item" title="Total Accepted Cuts">
            <span className="production-kpi-icon" aria-hidden="true">
              <CheckCircle2 size={18} strokeWidth={1.75} color="var(--c-success)" />
            </span>
            <div className="production-kpi-metric">
              <span className="production-kpi-value">{summary.totalAccepted ?? 0}</span>
              <span className="production-kpi-label">Accepted</span>
            </div>
          </div>

          <div className="production-kpi-item" title="Specified Cuts">
            <span className="production-kpi-icon" aria-hidden="true">
              <Tag size={18} strokeWidth={1.75} color="var(--c-accent)" />
            </span>
            <div className="production-kpi-metric">
              <span className="production-kpi-value">{summary.specifiedCount ?? 0}</span>
              <span className="production-kpi-label">Specified</span>
            </div>
          </div>

          <div className="production-kpi-item" title="Unspecified Cuts">
            <span className="production-kpi-icon" aria-hidden="true">
              <CircleDashed size={18} strokeWidth={1.75} color="var(--chart-warning)" />
            </span>
            <div className="production-kpi-metric">
              <span className="production-kpi-value">{summary.unspecifiedCount ?? 0}</span>
              <span className="production-kpi-label">Unspecified</span>
            </div>
          </div>
        </div>
      </header>

      {/* Error Notice */}
      {error ? (
        <div className="notice notice-error dashboard-alert production-notice" role="alert">
          <div className="production-notice-content">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary table-action-button"
            onClick={() => loadData()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Filter Strip */}
      <section className="production-filter-strip" aria-label="Production Log Filters">
        <div className="production-search-wrapper">
          <Search size={16} className="production-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="production-search-input"
            placeholder="Search label, size, or ID..."
            aria-label="Search production cuts"
            value={searchInput}
            maxLength={100}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>

        <input
          type="date"
          className="production-date-input"
          aria-label="Filter by date"
          value={dateFilter}
          onChange={handleDateChange}
        />

        <select
          className="production-select"
          aria-label="Filter by cut status"
          value={statusFilter}
          onChange={handleStatusChange}
        >
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="all">All Statuses</option>
        </select>

        <select
          className="production-select"
          aria-label="Filter by specification status"
          value={specStatusFilter}
          onChange={handleSpecStatusChange}
        >
          <option value="all">All Specifications</option>
          <option value="specified">Specified</option>
          <option value="unspecified">Unspecified</option>
        </select>

        <button
          type="button"
          className="production-bare-btn"
          aria-label="Refresh production logs"
          title="Refresh production logs"
          disabled={isLoading}
          onClick={() => loadData({ silent: true })}
        >
          <RotateCw size={16} className={isRefreshing ? 'spin-icon' : ''} aria-hidden="true" />
        </button>
      </section>

      {/* Main Table / Skeleton View */}
      {isLoading ? (
        <div className="skeleton production-skeleton" role="status" aria-label="Loading production records" />
      ) : (
        <div className="production-table-container">
          <table className="production-table" aria-label="Production Cuts Table">
            <thead>
              <tr>
                <th className="production-col-status">Status</th>
                <th>Cut Timestamp (PHT)</th>
                <th>Label</th>
                <th>Size</th>
                <th className="production-col-num">Diameter</th>
                <th className="production-col-num">Radius</th>
                <th className="production-col-num">Circumference</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="production-empty-state">
                    No production records found for the selected filters.
                  </td>
                </tr>
              ) : (
                records.map((record) => {
                  const isAccepted = Boolean(record.outputAccepted)
                  const isSpec = Boolean(record.isSpecified)

                  let statusIcon = null
                  if (!isAccepted) {
                    statusIcon = (
                      <span
                        className="production-status-icon"
                        title={record.rejectionReason || 'Rejected pulse'}
                        aria-label={record.rejectionReason || 'Rejected pulse'}
                      >
                        <CircleSlash size={16} strokeWidth={1.75} color="var(--c-danger)" aria-hidden="true" />
                      </span>
                    )
                  } else if (isSpec) {
                    statusIcon = (
                      <span
                        className="production-status-icon"
                        title="Accepted · Specified"
                        aria-label="Accepted · Specified"
                      >
                        <CheckCircle2 size={16} strokeWidth={1.75} color="var(--c-success)" aria-hidden="true" />
                      </span>
                    )
                  } else {
                    statusIcon = (
                      <span
                        className="production-status-icon"
                        title="Accepted · Needs details"
                        aria-label="Accepted · Needs details"
                      >
                        <CircleDashed size={16} strokeWidth={1.75} color="var(--chart-warning)" aria-hidden="true" />
                      </span>
                    )
                  }

                  return (
                    <tr key={record.id || record.sensorEventId}>
                      <td className="production-col-status">
                        <div className="production-status-cell">{statusIcon}</div>
                      </td>
                      <td className="production-col-timestamp">
                        {formatManilaDateTime(record.recordedAt || record.timestamp)}
                      </td>
                      <td>{record.label || <span className="production-placeholder">—</span>}</td>
                      <td>{record.size || <span className="production-placeholder">—</span>}</td>
                      <td className="production-col-num">
                        {record.diameter !== null && record.diameter !== undefined ? (
                          formatDimension(record.diameter)
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                      <td className="production-col-num">
                        {record.radius !== null && record.radius !== undefined ? (
                          formatDimension(record.radius)
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                      <td className="production-col-num">
                        {record.circumference !== null && record.circumference !== undefined ? (
                          formatDimension(record.circumference)
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      {!isLoading && (
        <footer className="production-pagination">
          <div className="production-pagination-info">
            Page {pagination.page} of {pagination.totalPages || 1} · {pagination.total} records
          </div>
          <div className="production-pagination-actions">
            <button
              type="button"
              className="production-bare-btn"
              disabled={!pagination.hasPreviousPage}
              onClick={handlePreviousPage}
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="production-bare-btn"
              disabled={!pagination.hasNextPage}
              onClick={handleNextPage}
              aria-label="Next page"
              title="Next page"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}

