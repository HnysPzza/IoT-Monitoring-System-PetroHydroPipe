import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  CopyCheck,
  Pencil,
  RotateCw,
  Search,
  Tag,
  X,
} from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName, getSensorLabel } from '../../../shared/constants/sensorIdentity.js'
import {
  batchUpdateProductionSpecs,
  getProductionLogs,
  updateProductionLogSpec,
} from './productionService.js'
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

const PRODUCTION_EDIT_ROLES = new Set(['Admin', 'Operation Manager', 'Production Supervisor'])

export default function ProductionSection({
  loadProduction = getProductionLogs,
  updateProduction = updateProductionLogSpec,
  updateProductionSpec,
  batchUpdateProduction = batchUpdateProductionSpecs,
  batchUpdateProductionSpecs: batchUpdateProductionSpecsProp,
}) {
  const updateFn = updateProductionSpec || updateProduction
  const batchUpdateFn = batchUpdateProductionSpecsProp || batchUpdateProduction || batchUpdateProductionSpecs
  const { token, user } = useAuth()
  const canEdit = PRODUCTION_EDIT_ROLES.has(user?.role)

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
  const [conflictNotice, setConflictNotice] = useState(null)

  const [editingRecordId, setEditingRecordId] = useState(null)
  const [editForm, setEditForm] = useState({
    label: '',
    size: '',
    diameter: '',
    radius: '',
    circumference: '',
  })
  const [flashingRecordId, setFlashingRecordId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkForm, setBulkForm] = useState({
    label: '',
    size: '',
    diameter: '',
    radius: '',
    circumference: '',
  })
  const [isConfirmingBulk, setIsConfirmingBulk] = useState(false)
  const [isApplyingBulk, setIsApplyingBulk] = useState(false)
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false)
  const [calcDimensions, setCalcDimensions] = useState({
    diameter: '',
    radius: '',
    circumference: '',
  })
  const [flashingRecordIds, setFlashingRecordIds] = useState(() => new Set())

  const requestIdRef = useRef(0)
  const flashTimeoutRef = useRef(null)
  const lastClickedIndexRef = useRef(null)
  const headerCheckboxRef = useRef(null)

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  // Reset last clicked index on page or filter changes
  useEffect(() => {
    lastClickedIndexRef.current = null
  }, [dateFilter, statusFilter, specStatusFilter, debouncedSearch, page])

  const pageAcceptedRecords = records.filter((r) => r.outputAccepted)
  const pageAcceptedIds = pageAcceptedRecords.map((r) => r.id || r.sensorEventId)
  const selectableCount = pageAcceptedIds.length
  const pageSelectedCount = pageAcceptedIds.filter((id) => selectedIds.has(id)).length
  const allPageSelected = selectableCount > 0 && pageSelectedCount === selectableCount
  const somePageSelected = pageSelectedCount > 0 && pageSelectedCount < selectableCount

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = somePageSelected
    }
  }, [somePageSelected])

  const handleSelectAllToggle = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        pageAcceptedIds.forEach((id) => next.delete(id))
      } else {
        pageAcceptedIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const handleRowCheckboxClick = (e, record, index) => {
    if (!record.outputAccepted) return
    const rowId = record.id || record.sensorEventId
    const isShift = Boolean(e.shiftKey || e.nativeEvent?.shiftKey)

    if (isShift && lastClickedIndexRef.current !== null && lastClickedIndexRef.current !== index) {
      const start = Math.min(lastClickedIndexRef.current, index)
      const end = Math.max(lastClickedIndexRef.current, index)
      const targetIds = []
      for (let i = start; i <= end; i++) {
        const item = records[i]
        if (item && item.outputAccepted) {
          targetIds.push(item.id || item.sensorEventId)
        }
      }
      setSelectedIds((prev) => {
        const next = new Set(prev)
        const shouldSelect = !prev.has(rowId)
        targetIds.forEach((id) => {
          if (shouldSelect) {
            next.add(id)
          } else {
            next.delete(id)
          }
        })
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(rowId)) {
          next.delete(rowId)
        } else {
          next.add(rowId)
        }
        return next
      })
    }
    lastClickedIndexRef.current = index
  }

  const handleDeselectAll = () => {
    setSelectedIds(new Set())
    setIsConfirmingBulk(false)
  }

  const handleRepeatLastSpec = () => {
    const lastSpec = records.find(
      (r) =>
        r.isSpecified ||
        Boolean(r.label || r.size || r.diameter != null || r.radius != null || r.circumference != null),
    )
    if (!lastSpec) return
    setBulkForm({
      label: lastSpec.label || '',
      size: lastSpec.size || '',
      diameter: lastSpec.diameter !== null && lastSpec.diameter !== undefined ? String(lastSpec.diameter) : '',
      radius: lastSpec.radius !== null && lastSpec.radius !== undefined ? String(lastSpec.radius) : '',
      circumference:
        lastSpec.circumference !== null && lastSpec.circumference !== undefined ? String(lastSpec.circumference) : '',
    })
  }

  const handleOpenCalculator = () => {
    if (!isCalculatorOpen) {
      setCalcDimensions({
        diameter: bulkForm.diameter || '',
        radius: bulkForm.radius || '',
        circumference: bulkForm.circumference || '',
      })
    }
    setIsCalculatorOpen((prev) => !prev)
  }

  const handleCalcDiameterChange = (val) => {
    const d = parseFloat(val)
    if (!isNaN(d) && d > 0) {
      const r = (d / 2).toFixed(2)
      const c = (d * Math.PI).toFixed(2)
      setCalcDimensions({
        diameter: val,
        radius: r,
        circumference: c,
      })
    } else {
      setCalcDimensions({
        diameter: val,
        radius: '',
        circumference: '',
      })
    }
  }

  const handleCalcRadiusChange = (val) => {
    const r = parseFloat(val)
    if (!isNaN(r) && r > 0) {
      const d = (r * 2).toFixed(2)
      const c = (2 * Math.PI * r).toFixed(2)
      setCalcDimensions({
        diameter: d,
        radius: val,
        circumference: c,
      })
    } else {
      setCalcDimensions({
        diameter: '',
        radius: val,
        circumference: '',
      })
    }
  }

  const handleCalcCircumferenceChange = (val) => {
    const c = parseFloat(val)
    if (!isNaN(c) && c > 0) {
      const d = (c / Math.PI).toFixed(2)
      const r = (c / (2 * Math.PI)).toFixed(2)
      setCalcDimensions({
        diameter: d,
        radius: r,
        circumference: val,
      })
    } else {
      setCalcDimensions({
        diameter: '',
        radius: '',
        circumference: val,
      })
    }
  }

  const handleApplyCalculator = () => {
    setBulkForm((prev) => ({
      ...prev,
      diameter: calcDimensions.diameter || prev.diameter,
      radius: calcDimensions.radius || prev.radius,
      circumference: calcDimensions.circumference || prev.circumference,
    }))
    setIsCalculatorOpen(false)
  }

  const handleBulkApplyClick = () => {
    const hasField = Boolean(
      bulkForm.label.trim() ||
        bulkForm.size.trim() ||
        (bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter))) ||
        (bulkForm.radius !== '' && !isNaN(Number(bulkForm.radius))) ||
        (bulkForm.circumference !== '' && !isNaN(Number(bulkForm.circumference))),
    )
    if (!hasField) {
      setError('Provide at least one specification field to update.')
      return
    }
    setError(null)
    setIsConfirmingBulk(true)
  }

  const handleConfirmBulkApply = async () => {
    setIsConfirmingBulk(false)
    setIsApplyingBulk(true)
    setError(null)

    const targetIds = Array.from(selectedIds)
    const prevRecords = records
    const prevSummary = summary

    const newLabel = bulkForm.label.trim() || undefined
    const newSize = bulkForm.size.trim() || undefined
    const newDiameter =
      bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter)) ? Number(bulkForm.diameter) : undefined
    const newRadius =
      bulkForm.radius !== '' && !isNaN(Number(bulkForm.radius)) ? Number(bulkForm.radius) : undefined
    const newCircumference =
      bulkForm.circumference !== '' && !isNaN(Number(bulkForm.circumference))
        ? Number(bulkForm.circumference)
        : undefined

    const appliedSpec = {}
    if (newLabel !== undefined) appliedSpec.label = newLabel
    if (newSize !== undefined) appliedSpec.size = newSize
    if (newDiameter !== undefined) appliedSpec.diameter = newDiameter
    if (newRadius !== undefined) appliedSpec.radius = newRadius
    if (newCircumference !== undefined) appliedSpec.circumference = newCircumference

    let newlySpecifiedCount = 0
    const targetSet = new Set(targetIds)
    setRecords((prev) =>
      prev.map((r) => {
        const id = r.id || r.sensorEventId
        if (!targetSet.has(id)) return r
        const effLabel = newLabel !== undefined ? newLabel : r.label
        const effSize = newSize !== undefined ? newSize : r.size
        const effDiameter = newDiameter !== undefined ? newDiameter : r.diameter
        const effRadius = newRadius !== undefined ? newRadius : r.radius
        const effCircumference = newCircumference !== undefined ? newCircumference : r.circumference
        const isNowSpecified = Boolean(
          effLabel || effSize || effDiameter != null || effRadius != null || effCircumference != null,
        )
        if (!r.isSpecified && isNowSpecified) {
          newlySpecifiedCount++
        }
        return {
          ...r,
          label: effLabel,
          size: effSize,
          diameter: effDiameter,
          radius: effRadius,
          circumference: effCircumference,
          isSpecified: isNowSpecified,
          specStatus: isNowSpecified ? 'specified' : 'unspecified',
        }
      }),
    )

    if (newlySpecifiedCount > 0) {
      setSummary((prev) => ({
        ...prev,
        specifiedCount: (prev.specifiedCount ?? 0) + newlySpecifiedCount,
        unspecifiedCount: Math.max(0, (prev.unspecifiedCount ?? 0) - newlySpecifiedCount),
      }))
    }

    setFlashingRecordIds(new Set(targetIds))
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingRecordIds(new Set())
    }, 150)

    try {
      await batchUpdateFn(token, {
        sensorEventIds: targetIds,
        appliedSpec,
      })

      setSelectedIds(new Set())
      setBulkForm({
        label: '',
        size: '',
        diameter: '',
        radius: '',
        circumference: '',
      })
      loadData({ silent: true })
    } catch (err) {
      setRecords(prevRecords)
      setSummary(prevSummary)
      setError(err.message || 'Unable to update production specifications.')
    } finally {
      setIsApplyingBulk(false)
    }
  }

  const handleToggleUnspecified = () => {
    setSpecStatusFilter((prev) => (prev === 'unspecified' ? 'all' : 'unspecified'))
    setPage(1)
  }

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

  const handleStartEdit = (record) => {
    const rowId = record.id || record.sensorEventId
    setEditingRecordId(rowId)
    setConflictNotice(null)
    setEditForm({
      label: record.label ?? '',
      size: record.size ?? '',
      diameter: record.diameter !== null && record.diameter !== undefined ? String(record.diameter) : '',
      radius: record.radius !== null && record.radius !== undefined ? String(record.radius) : '',
      circumference: record.circumference !== null && record.circumference !== undefined ? String(record.circumference) : '',
    })
  }

  const handleCancel = () => {
    setEditingRecordId(null)
    setEditForm({
      label: '',
      size: '',
      diameter: '',
      radius: '',
      circumference: '',
    })
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setEditForm((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleInputKeyDown = (e, record) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave(record)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  const handleSave = async (record) => {
    const rowId = record.id || record.sensorEventId
    setEditingRecordId(null)

    const prevRecords = records
    const prevSummary = summary

    const newLabel = editForm.label?.trim() || null
    const newSize = editForm.size?.trim() || null
    const newDiameter = editForm.diameter === '' || editForm.diameter === null ? null : Number(editForm.diameter)
    const newRadius = editForm.radius === '' || editForm.radius === null ? null : Number(editForm.radius)
    const newCircumference = editForm.circumference === '' || editForm.circumference === null ? null : Number(editForm.circumference)

    const isNowSpecified = Boolean(newLabel || newSize || newDiameter || newRadius || newCircumference)
    const wasSpecified = Boolean(record.isSpecified)

    setRecords((prev) =>
      prev.map((r) => {
        if ((r.id || r.sensorEventId) === rowId) {
          return {
            ...r,
            label: newLabel,
            size: newSize,
            diameter: newDiameter,
            radius: newRadius,
            circumference: newCircumference,
            isSpecified: isNowSpecified,
            specStatus: isNowSpecified ? 'specified' : 'unspecified',
          }
        }
        return r
      }),
    )

    if (!wasSpecified && isNowSpecified) {
      setSummary((prev) => ({
        ...prev,
        specifiedCount: (prev.specifiedCount ?? 0) + 1,
        unspecifiedCount: Math.max(0, (prev.unspecifiedCount ?? 0) - 1),
      }))
    } else if (wasSpecified && !isNowSpecified) {
      setSummary((prev) => ({
        ...prev,
        specifiedCount: Math.max(0, (prev.specifiedCount ?? 0) - 1),
        unspecifiedCount: (prev.unspecifiedCount ?? 0) + 1,
      }))
    }

    setFlashingRecordId(rowId)
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingRecordId(null)
    }, 150)

    const payload = {
      label: newLabel,
      size: newSize,
      diameter: newDiameter,
      radius: newRadius,
      circumference: newCircumference,
    }

    try {
      const response = await updateFn(
        token,
        rowId,
        payload,
        record.updatedAt,
      )

      if (response?.spec) {
        setRecords((prev) =>
          prev.map((r) => {
            if ((r.id || r.sensorEventId) === rowId) {
              return {
                ...r,
                ...response.spec,
                updatedAt: response.spec.updatedAt || r.updatedAt,
              }
            }
            return r
          }),
        )
      }
    } catch (err) {
      const isConflict =
        err?.status === 409 ||
        err?.code === 'PRODUCTION_SPEC_CONFLICT' ||
        (err?.message && /modified by another user/i.test(err.message))

      if (isConflict) {
        setRecords(prevRecords)
        setSummary(prevSummary)
        setConflictNotice('Production specification was modified by another user.')
        loadData({ silent: true })
      } else {
        setRecords(prevRecords)
        setSummary(prevSummary)
        setError(err.message || 'Unable to update production specification.')
      }
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

          <button
            type="button"
            className={`production-kpi-item production-kpi-btn ${specStatusFilter === 'unspecified' ? 'production-kpi-active' : ''}`}
            title={specStatusFilter === 'unspecified' ? 'Show all cuts' : 'Filter unspecified cuts'}
            aria-label="Filter unspecified cuts"
            aria-pressed={specStatusFilter === 'unspecified'}
            onClick={handleToggleUnspecified}
          >
            <span className="production-kpi-icon" aria-hidden="true">
              <CircleDashed size={18} strokeWidth={1.75} color="var(--chart-warning)" />
            </span>
            <div className="production-kpi-metric">
              <span className="production-kpi-value">{summary.unspecifiedCount ?? 0}</span>
              <span className="production-kpi-label">Unspecified</span>
            </div>
          </button>
        </div>
      </header>

      {/* Conflict Notice */}
      {conflictNotice ? (
        <div className="notice notice-warning dashboard-alert production-notice production-conflict-notice" role="alert">
          <div className="production-notice-content">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{conflictNotice}</span>
          </div>
          <button
            type="button"
            className="production-bare-btn"
            onClick={() => setConflictNotice(null)}
            aria-label="Dismiss notice"
            title="Dismiss notice"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

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
          className={`production-bare-btn ${specStatusFilter === 'unspecified' ? 'production-filter-btn-active' : ''}`}
          aria-label="Toggle unspecified cuts filter"
          title={specStatusFilter === 'unspecified' ? 'Show all specifications' : 'Show unspecified cuts only'}
          onClick={handleToggleUnspecified}
        >
          <CircleDashed size={16} strokeWidth={1.75} color="var(--chart-warning)" aria-hidden="true" />
        </button>

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

      {/* Bulk Edit Strip */}
      {canEdit && selectedIds.size > 0 && (
        <section className="production-bulk-strip" role="region" aria-label="Bulk specification editor">
          <div className="production-bulk-header">
            <span className="production-bulk-count">
              {selectedIds.size} {selectedIds.size === 1 ? 'cut' : 'cuts'} selected
            </span>
            <button
              type="button"
              className="production-bare-btn production-deselect-btn"
              onClick={handleDeselectAll}
              aria-label="Deselect all cuts"
            >
              <X size={14} aria-hidden="true" />
              Deselect all
            </button>
          </div>

          {isConfirmingBulk ? (
            <div className="production-bulk-confirmation" role="alert">
              <span>
                Apply specifications to {selectedIds.size} {selectedIds.size === 1 ? 'cut' : 'cuts'}? Blank fields will keep their current values.
              </span>
              <div className="production-confirm-buttons">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirmBulkApply}
                  disabled={isApplyingBulk}
                >
                  {isApplyingBulk ? 'Applying...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsConfirmingBulk(false)}
                  disabled={isApplyingBulk}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="production-bulk-fields">
              <input
                type="text"
                className="production-inline-input production-bulk-input"
                placeholder="Label (optional)"
                aria-label="Bulk label"
                value={bulkForm.label}
                maxLength={100}
                onChange={(e) => setBulkForm((prev) => ({ ...prev, label: e.target.value }))}
              />
              <input
                type="text"
                className="production-inline-input production-bulk-input"
                placeholder="Size (optional)"
                aria-label="Bulk size"
                value={bulkForm.size}
                maxLength={50}
                onChange={(e) => setBulkForm((prev) => ({ ...prev, size: e.target.value }))}
              />
              <input
                type="number"
                className="production-inline-input production-inline-num production-bulk-input"
                placeholder="Diameter"
                aria-label="Bulk diameter"
                step="any"
                min="0"
                value={bulkForm.diameter}
                onChange={(e) => setBulkForm((prev) => ({ ...prev, diameter: e.target.value }))}
              />
              <input
                type="number"
                className="production-inline-input production-inline-num production-bulk-input"
                placeholder="Radius"
                aria-label="Bulk radius"
                step="any"
                min="0"
                value={bulkForm.radius}
                onChange={(e) => setBulkForm((prev) => ({ ...prev, radius: e.target.value }))}
              />
              <input
                type="number"
                className="production-inline-input production-inline-num production-bulk-input"
                placeholder="Circumference"
                aria-label="Bulk circumference"
                step="any"
                min="0"
                value={bulkForm.circumference}
                onChange={(e) => setBulkForm((prev) => ({ ...prev, circumference: e.target.value }))}
              />

              <div className="production-bulk-tools">
                <button
                  type="button"
                  className="production-bare-btn"
                  title="Repeat last saved specification"
                  aria-label="Repeat last saved specification"
                  onClick={handleRepeatLastSpec}
                >
                  <CopyCheck size={16} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className={`production-bare-btn ${isCalculatorOpen ? 'production-tool-active' : ''}`}
                  title="Geometry Calculator"
                  aria-label="Geometry Calculator"
                  onClick={handleOpenCalculator}
                >
                  <Calculator size={16} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="production-bulk-apply-btn"
                  onClick={handleBulkApplyClick}
                  disabled={isApplyingBulk}
                >
                  Apply to {selectedIds.size} {selectedIds.size === 1 ? 'cut' : 'cuts'}
                </button>
              </div>
            </div>
          )}

          {isCalculatorOpen && (
            <div className="production-calculator-popover" role="dialog" aria-label="Geometry Calculator">
              <div className="production-calc-header">
                <span className="production-calc-title">Geometry Calculator</span>
                <button
                  type="button"
                  className="production-bare-btn"
                  aria-label="Close calculator"
                  onClick={() => setIsCalculatorOpen(false)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <p className="production-calc-hint">Enter one dimension to calculate the other two.</p>
              <div className="production-calc-inputs">
                <label className="production-calc-label">
                  <span>Diameter (mm)</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    aria-label="Calculator diameter"
                    className="production-inline-input"
                    placeholder="0.00"
                    value={calcDimensions.diameter}
                    onChange={(e) => handleCalcDiameterChange(e.target.value)}
                  />
                </label>
                <label className="production-calc-label">
                  <span>Radius (mm)</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    aria-label="Calculator radius"
                    className="production-inline-input"
                    placeholder="0.00"
                    value={calcDimensions.radius}
                    onChange={(e) => handleCalcRadiusChange(e.target.value)}
                  />
                </label>
                <label className="production-calc-label">
                  <span>Circumference (mm)</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    aria-label="Calculator circumference"
                    className="production-inline-input"
                    placeholder="0.00"
                    value={calcDimensions.circumference}
                    onChange={(e) => handleCalcCircumferenceChange(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn btn-secondary production-calc-apply"
                onClick={handleApplyCalculator}
              >
                Apply to bulk form
              </button>
            </div>
          )}
        </section>
      )}

      {/* Main Table / Skeleton View */}
      {isLoading ? (
        <div className="skeleton production-skeleton" role="status" aria-label="Loading production records" />
      ) : (
        <div className="production-table-container">
          <table className="production-table" aria-label="Production Cuts Table">
            <thead>
              <tr>
                {canEdit && (
                  <th className="production-col-select">
                    <input
                      type="checkbox"
                      ref={headerCheckboxRef}
                      className="production-checkbox"
                      checked={allPageSelected}
                      disabled={selectableCount === 0}
                      onChange={handleSelectAllToggle}
                      aria-label="Select all cuts on this page"
                    />
                  </th>
                )}
                <th className="production-col-status">Status</th>
                <th>Cut Timestamp (PHT)</th>
                <th>Label</th>
                <th>Size</th>
                <th className="production-col-num">Diameter</th>
                <th className="production-col-num">Radius</th>
                <th className="production-col-num">Circumference</th>
                {canEdit && <th className="production-col-action">Action</th>}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 9 : 7} className="production-empty-state">
                    No production records found for the selected filters.
                  </td>
                </tr>
              ) : (
                records.map((record, index) => {
                  const rowId = record.id || record.sensorEventId
                  const isAccepted = Boolean(record.outputAccepted)
                  const isSpec = Boolean(record.isSpecified)
                  const isEditing = editingRecordId === rowId
                  const isFlashing = flashingRecordId === rowId || flashingRecordIds.has(rowId)

                  let rowClass = ''
                  if (isEditing) rowClass = 'production-row-editing'
                  if (isFlashing) rowClass = rowClass ? `${rowClass} production-row-flash` : 'production-row-flash'

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
                    <tr key={rowId} className={rowClass || undefined}>
                      {canEdit && (
                        <td className="production-col-select">
                          <input
                            type="checkbox"
                            className="production-checkbox"
                            checked={selectedIds.has(rowId)}
                            disabled={!isAccepted}
                            onChange={() => {}}
                            onClick={(e) => handleRowCheckboxClick(e, record, index)}
                            aria-label={`Select cut at ${record.recordedAt || record.timestamp}`}
                          />
                        </td>
                      )}
                      <td className="production-col-status">
                        <div className="production-status-cell">{statusIcon}</div>
                      </td>
                      <td className="production-col-timestamp">
                        {formatManilaDateTime(record.recordedAt || record.timestamp)}
                      </td>
                      {isEditing ? (
                        <>
                          <td>
                            <input
                              type="text"
                              className="production-inline-input"
                              aria-label="Specification label"
                              name="label"
                              value={editForm.label}
                              maxLength={100}
                              autoFocus
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="production-inline-input"
                              aria-label="Specification size"
                              name="size"
                              value={editForm.size}
                              maxLength={50}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num">
                            <input
                              type="number"
                              className="production-inline-input production-inline-num"
                              aria-label="Specification diameter"
                              name="diameter"
                              step="any"
                              min="0"
                              value={editForm.diameter}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num">
                            <input
                              type="number"
                              className="production-inline-input production-inline-num"
                              aria-label="Specification radius"
                              name="radius"
                              step="any"
                              min="0"
                              value={editForm.radius}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num">
                            <input
                              type="number"
                              className="production-inline-input production-inline-num"
                              aria-label="Specification circumference"
                              name="circumference"
                              step="any"
                              min="0"
                              value={editForm.circumference}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                      {canEdit && (
                        <td className="production-col-action">
                          {isEditing ? (
                            <div className="production-inline-actions">
                              <button
                                type="button"
                                className="production-action-btn production-save-btn"
                                aria-label="Save specification"
                                title="Save specification"
                                onClick={() => handleSave(record)}
                              >
                                <Check size={16} strokeWidth={2} color="var(--c-success)" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="production-action-btn production-cancel-btn"
                                aria-label="Cancel editing"
                                title="Cancel editing"
                                onClick={handleCancel}
                              >
                                <X size={16} strokeWidth={2} color="var(--c-text-3)" aria-hidden="true" />
                              </button>
                            </div>
                          ) : isAccepted ? (
                            <button
                              type="button"
                              className="production-action-btn"
                              aria-label="Edit specification"
                              title="Edit specification"
                              onClick={() => handleStartEdit(record)}
                            >
                              <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                            </button>
                          ) : null}
                        </td>
                      )}
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

