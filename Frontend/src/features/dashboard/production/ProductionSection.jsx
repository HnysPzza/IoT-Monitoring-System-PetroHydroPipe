import { useCallback, useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  RotateCw,
  Search,
  Tag,
  X,
} from 'lucide-react'
import RefreshStatus from '../../../shared/components/RefreshStatus.jsx'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'
import ProductionDateRangePicker from './ProductionDateRangePicker.jsx'
import ProductionStatusDropdown from './ProductionStatusDropdown.jsx'
import ProductionBulkBar from './ProductionBulkBar.jsx'
import ProductionTable from './ProductionTable.jsx'
import { useProductionMutations } from './useProductionMutations.js'
import {
  PRODUCTION_EDIT_ROLES,
  SPEC_STATUS_OPTIONS,
  calculatePipeTonnage,
  formatManilaDateTime,
  formatTonnage,
  getManilaDateInputValue,
  hasInformation,
  parseProductionDate,
} from './productionUtils.js'
import {
  batchUpdateProductionSpecs,
  getProductionLogs,
  updateProductionLogSpec,
} from './productionService.js'
import './ProductionSection.css'

export {
  calculatePipeTonnage,
  formatManilaDateTime,
  getManilaDateInputValue,
  hasInformation,
  parseProductionDate,
}

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
  const queryClient = useQueryClient()
  const online = useNetworkOnline()

  const [dateFilter, setDateFilter] = useState(getManilaDateInputValue)
  const [specStatusFilter, setSpecStatusFilter] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const [error, setError] = useState(null)
  const [conflictNotice, setConflictNotice] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const lastClickedIndexRef = useRef(null)

  const normFilter = typeof dateFilter === 'string'
    ? (dateFilter ? { type: 'day', startDate: dateFilter, endDate: dateFilter } : { type: 'all' })
    : dateFilter
  const start = normFilter?.startDate || normFilter?.date
  const end = normFilter?.endDate
  const oneDay = start && (normFilter?.type === 'today' || normFilter?.type === 'day' || start === end)
  const filters = {
    date: oneDay ? start : undefined,
    dateFrom: !oneDay && normFilter?.type !== 'all' && start && end ? start : undefined,
    dateTo: !oneDay && normFilter?.type !== 'all' && start && end ? end : undefined,
    status: 'accepted',
    specStatus: specStatusFilter,
    search: debouncedSearch || undefined,
    page,
    pageSize,
  }
  const key = queryKeys.production.list(filters)
  const query = useAuthenticatedQuery({
    queryKey: key,
    queryFn: ({ token: currentToken, signal }) => loadProduction(currentToken, { ...filters, signal }),
    staleTime: 30000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })

  const canEdit = PRODUCTION_EDIT_ROLES.has(user?.role) && !query.isPlaceholderData
  const records = query.data?.records || []
  const summary = query.data?.summary || { totalAccepted: 0, specifiedCount: 0, unspecifiedCount: 0, rejectedCount: 0, totalTonnage: 0 }
  const pagination = query.data?.pagination || { page: 1, pageSize: 25, total: 0, totalPages: 1 }
  const isLoading = query.isPending && !query.data
  const isRefreshing = query.isFetching && Boolean(query.data)
  const totalPages = Math.max(1, pagination.totalPages || 1)
  const isPageTransition = query.isPlaceholderData && query.isFetching
  const canGoPrevious = !isLoading && !isPageTransition && page > 1 && (query.isPlaceholderData || Boolean(pagination.hasPreviousPage))
  const canGoNext = !isLoading && !query.isPlaceholderData && Boolean(pagination.hasNextPage) && page < totalPages
  const loadData = () => query.refetch()

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const {
    bulkForm,
    editForm,
    editingRecordId,
    flashingRecordId,
    flashingRecordIds,
    handleBulkApplyClick,
    handleBulkCustomerChange,
    handleBulkDimensionChange,
    handleBulkKeyDown,
    handleBulkTonnageChange,
    handleCancel,
    handleConfirmBulkApply,
    handleInputChange,
    handleInputKeyDown,
    handleRepeatLastSpec,
    handleSave,
    handleStartEdit,
    isApplyingBulk,
    isConfirmingBulk,
    resetBulkConfirm,
    savingRecordIds,
  } = useProductionMutations({
    token,
    user,
    queryClient,
    queryKey: key,
    records,
    updateFn,
    batchUpdateFn,
    selectedIds,
    onClearSelection: clearSelection,
    onRefetch: loadData,
    setError,
    setConflictNotice,
    setAnnouncement,
  })

  // Clear row selection and transient confirm state when query scope changes.
  useEffect(() => {
    lastClickedIndexRef.current = null
    setSelectedIds((prev) => (prev.size > 0 ? new Set() : prev))
    resetBulkConfirm()
  }, [dateFilter, specStatusFilter, debouncedSearch, page, resetBulkConfirm])

  // Clamp requested page within available pages when filtered counts shrink.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return
    const serverTotalPages = Math.max(1, query.data.pagination?.totalPages || 1)
    if (page > serverTotalPages) {
      queryClient.invalidateQueries({ queryKey: queryKeys.production.all, refetchType: 'none' })
      setPage(serverTotalPages)
    }
  }, [query.data, query.isPlaceholderData, page, queryClient])

  // Debounce search input changes without resetting page on initial mount.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === debouncedSearch) return undefined
    const timer = setTimeout(() => {
      setDebouncedSearch(trimmed)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, debouncedSearch])

  const pageAcceptedRecords = records.filter((r) => r.outputAccepted)
  const pageAcceptedIds = pageAcceptedRecords.map((r) => r.id || r.sensorEventId)
  const pageUnfilledRecords = pageAcceptedRecords.filter((r) => !hasInformation(r))
  const pageUnfilledIds = pageUnfilledRecords.map((r) => r.id || r.sensorEventId)

  const batchTargetIds = pageUnfilledIds
  const pageBatchTargetCount = batchTargetIds.length
  const batchTargetSelectedCount = batchTargetIds.filter((id) => selectedIds.has(id)).length
  const pageSelectedCount = pageAcceptedIds.filter((id) => selectedIds.has(id)).length

  const allBatchTargetsSelected = pageBatchTargetCount > 0 && batchTargetSelectedCount === pageBatchTargetCount
  const allPageAcceptedSelected = pageAcceptedIds.length > 0 && pageSelectedCount === pageAcceptedIds.length

  const isHeaderChecked = allBatchTargetsSelected || allPageAcceptedSelected
  const isHeaderIndeterminate = pageSelectedCount > 0 && !isHeaderChecked
  const isHeaderDisabled = pageAcceptedIds.length === 0 || (pageBatchTargetCount === 0 && pageSelectedCount === 0)
  const maxProductionDate = parseProductionDate(getManilaDateInputValue())

  const handleSelectAllToggle = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (isHeaderChecked) {
        pageAcceptedIds.forEach((id) => next.delete(id))
      } else {
        batchTargetIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const handleRowCheckboxClick = (e, record, index) => {
    if (!record.outputAccepted) return
    const rowId = record.id || record.sensorEventId
    const isShift = Boolean(e.shiftKey || e.nativeEvent?.shiftKey)

    if (isShift && lastClickedIndexRef.current !== null && lastClickedIndexRef.current !== index) {
      const rangeStart = Math.min(lastClickedIndexRef.current, index)
      const rangeEnd = Math.max(lastClickedIndexRef.current, index)
      const targetIds = []
      for (let i = rangeStart; i <= rangeEnd; i++) {
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
    resetBulkConfirm()
  }

  const handleSpecStatusToggle = (targetSpecStatus) => {
    setSpecStatusFilter((prev) => (prev === targetSpecStatus ? 'all' : targetSpecStatus))
    setPage(1)
  }

  const handleDateFilterChange = (filter) => {
    setDateFilter(filter)
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
    if (!canGoPrevious) return
    setPage((prev) => Math.max(1, prev - 1))
  }

  const handleNextPage = () => {
    if (!canGoNext) return
    setPage((prev) => Math.min(totalPages, prev + 1))
  }

  if (!online && !query.data) {
    return (
      <div className="notice notice-error dashboard-alert production-offline-fallback" role="alert">
        <span>Unable to refresh while offline.</span>
        <button type="button" className="btn btn-secondary table-action-button" onClick={() => query.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="production-workspace">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <header className="production-header-strip">
        <div className="production-title-group sr-only">
          <p className="production-eyebrow">{`S-05 · ${getSensorLabel('S-05', 'Production Output Cutting').toUpperCase()} · SPIRAL MILL 01`}</p>
          <h1 className="production-title">Production Output</h1>
        </div>
        <div className="production-kpi-strip" role="region" aria-label="Production Summary Metrics">
          <button
            type="button"
            className="production-kpi-pill accepted"
            title="Total Accepted Cuts"
            aria-label="Total accepted cuts"
            onClick={() => {
              setSpecStatusFilter('all')
              setPage(1)
            }}
          >
            <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
            <strong className="production-kpi-value tabular-data">{summary.totalAccepted ?? 0}</strong>
            <span className="production-kpi-label">Accepted</span>
          </button>

          <div
            className="production-kpi-pill tonnage"
            title="Total Production Tonnage"
            aria-label="Total production tonnage"
          >
            <strong className="production-kpi-value tabular-data">
              {formatTonnage(summary.totalTonnage ?? 0) ?? '0.0000'}
            </strong>
            <span className="production-kpi-label">Total Tons</span>
          </div>

          <button
            type="button"
            className={`production-kpi-pill specified ${specStatusFilter === 'specified' ? 'production-kpi-active' : ''}`}
            title="Specified Cuts"
            aria-label="Filter specified cuts"
            aria-pressed={specStatusFilter === 'specified'}
            onClick={() => handleSpecStatusToggle('specified')}
          >
            <Tag size={14} strokeWidth={2} aria-hidden="true" />
            <strong className="production-kpi-value tabular-data">{summary.specifiedCount ?? 0}</strong>
            <span className="production-kpi-label">Specified</span>
          </button>

          <button
            type="button"
            className={`production-kpi-pill unspecified ${specStatusFilter === 'unspecified' ? 'production-kpi-active' : ''}`}
            title={specStatusFilter === 'unspecified' ? 'Show all cuts' : 'Filter unspecified cuts'}
            aria-label="Filter unspecified cuts"
            aria-pressed={specStatusFilter === 'unspecified'}
            onClick={() => handleSpecStatusToggle('unspecified')}
          >
            <CircleDashed size={14} strokeWidth={2} aria-hidden="true" />
            <strong className="production-kpi-value tabular-data">{summary.unspecifiedCount ?? 0}</strong>
            <span className="production-kpi-label">Unspecified</span>
          </button>
        </div>
      </header>

      <section className="production-filter-strip" aria-label="Production Output Filters">
        <div className="production-search-wrapper">
          <Search size={15} strokeWidth={1.75} className="production-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="production-search-input"
            placeholder="Search customer, pipe #, or ID..."
            aria-label="Search production cuts"
            value={searchInput}
            maxLength={100}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchInput ? (
            <button
              type="button"
              className="production-search-clear-btn"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => {
                setSearchInput('')
                setDebouncedSearch('')
                setPage(1)
              }}
            >
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <ProductionDateRangePicker
          value={dateFilter}
          onChange={handleDateFilterChange}
          maxDate={maxProductionDate}
          accessibleLabel="Select production date"
          triggerAriaLabel="Filter by date"
        />

        <ProductionStatusDropdown
          id="production-spec-status-filter"
          label="Filter by specification status"
          value={specStatusFilter}
          options={SPEC_STATUS_OPTIONS}
          onChange={(newVal) => {
            setSpecStatusFilter(newVal)
            setPage(1)
          }}
          isActive={specStatusFilter !== 'all'}
        />

        <button
          type="button"
          className="production-square-btn"
          aria-label="Refresh production output"
          title="Refresh production output"
          disabled={isLoading}
          onClick={() => loadData({ silent: true })}
        >
          <RotateCw size={15} strokeWidth={1.75} className={isRefreshing ? 'spin-icon' : ''} aria-hidden="true" />
        </button>
      </section>

      {conflictNotice ? (
        <div className="notice notice-warning dashboard-alert production-notice production-conflict-notice" role="alert">
          <div className="production-notice-content">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{conflictNotice}</span>
          </div>
          <button
            type="button"
            className="production-square-btn production-notice-dismiss-btn"
            onClick={() => setConflictNotice(null)}
            aria-label="Dismiss notice"
            title="Dismiss notice"
          >
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <RefreshStatus active={isRefreshing} isPlaceholder={query.isPlaceholderData} message="Refreshing production output..." placeholderMessage="Refreshing production output for the selected filters; previous results remain visible." />
      {query.isError || (!online && query.data) ? (
        <div className="notice notice-error dashboard-alert production-notice" role="alert">
          <div className="production-notice-content">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              {query.data
                ? `Production data is stale.${query.isPlaceholderData ? ' Showing previous filter results.' : ''}${query.dataUpdatedAt ? ` Last updated ${new Date(query.dataUpdatedAt).toLocaleString()}.` : ''} `
                : ''}
              {query.error?.message || 'Unable to refresh while offline.'}
            </span>
          </div>
          <button type="button" className="btn btn-secondary table-action-button" onClick={() => query.refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="notice notice-error dashboard-alert production-notice" role="alert">
          <div className="production-notice-content">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
          <div className="production-notice-actions">
            <button
              type="button"
              className="btn btn-secondary table-action-button"
              onClick={() => {
                setError(null)
                loadData()
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {canEdit && selectedIds.size > 0 && (
        <ProductionBulkBar
          selectedCount={selectedIds.size}
          bulkForm={bulkForm}
          isConfirmingBulk={isConfirmingBulk}
          isApplyingBulk={isApplyingBulk}
          onDeselectAll={handleDeselectAll}
          onCustomerChange={handleBulkCustomerChange}
          onDimensionChange={handleBulkDimensionChange}
          onTonnageChange={handleBulkTonnageChange}
          onKeyDown={handleBulkKeyDown}
          onRepeatLastSpec={handleRepeatLastSpec}
          onApplyClick={handleBulkApplyClick}
          onConfirmApply={handleConfirmBulkApply}
          onCancelConfirm={resetBulkConfirm}
        />
      )}

      {isLoading ? (
        <div className="skeleton production-skeleton" role="status" aria-label="Loading production records" />
      ) : (
        <ProductionTable
          records={records}
          canEdit={canEdit}
          isHeaderChecked={isHeaderChecked}
          isHeaderIndeterminate={isHeaderIndeterminate}
          isHeaderDisabled={isHeaderDisabled}
          selectedIds={selectedIds}
          editingRecordId={editingRecordId}
          editForm={editForm}
          savingRecordIds={savingRecordIds}
          flashingRecordId={flashingRecordId}
          flashingRecordIds={flashingRecordIds}
          onSelectAllToggle={handleSelectAllToggle}
          onRowCheckboxClick={handleRowCheckboxClick}
          onInputChange={handleInputChange}
          onInputKeyDown={handleInputKeyDown}
          onStartEdit={handleStartEdit}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}

      {!isLoading && (
        <footer className="production-pagination">
          <div className="production-pagination-info tabular-data">
            Page {pagination.page} of {totalPages} · {pagination.total} records
          </div>
          <div className="production-pagination-actions">
            <button
              type="button"
              className="production-pagination-btn"
              disabled={!canGoPrevious}
              onClick={handlePreviousPage}
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="production-pagination-btn"
              disabled={!canGoNext}
              onClick={handleNextPage}
              aria-label="Next page"
              title="Next page"
            >
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}
