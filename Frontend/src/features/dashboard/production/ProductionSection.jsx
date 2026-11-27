import Status from '../../../shared/components/Status.jsx'
import RefreshStatus from '../../../shared/components/RefreshStatus.jsx'
import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { getSessionGeneration } from '../../../shared/services/sessionRefresh.js'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Copy,
  Pencil,
  RotateCw,
  Search,
  Tag,
  X,
} from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'
import ProductionDateRangePicker from './ProductionDateRangePicker.jsx'
import {
  batchUpdateProductionSpecs,
  getProductionLogs,
  updateProductionLogSpec,
} from './productionService.js'
import './ProductionSection.css'

const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const MANILA_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function getManilaDateInputValue() {
  return MANILA_DATE_FORMATTER.format(new Date())
}

export function parseProductionDate(value) {
  if (!value) return undefined
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

export function formatProductionDateInput(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatProductionDateLabel(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatManilaDateTime(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return '—'
  return MANILA_DATETIME_FORMATTER.format(date).replace(', ', ' ')
}

function formatDimension(value) {
  if (value === null || value === undefined || isNaN(Number(value))) return null
  return Number(value).toFixed(2)
}

function formatTonnage(value) {
  if (value === null || value === undefined || isNaN(Number(value))) return null
  return Number(value).toFixed(4)
}

const STEEL_DENSITY_KG_PER_M3 = 7850

export function calculatePipeTonnage(diameter, thickness, length) {
  if (diameter == null || thickness == null || length == null) return null
  if (typeof diameter === 'string' && diameter.trim() === '') return null
  if (typeof thickness === 'string' && thickness.trim() === '') return null
  if (typeof length === 'string' && length.trim() === '') return null
  const d = Number(diameter)
  const t = Number(thickness)
  const l = Number(length)
  if (!Number.isFinite(d) || !Number.isFinite(t) || !Number.isFinite(l)) return null
  if (d <= 0 || t <= 0 || l <= 0 || d <= t) return null
  const weightKgPerMeter = Math.PI * (d - t) * t * (STEEL_DENSITY_KG_PER_M3 / 1000000)
  const totalWeightTons = (weightKgPerMeter * l) / 1000000
  const rounded = Math.round(totalWeightTons * 10000) / 10000
  return rounded > 0 ? rounded : null
}

export function hasInformation(record) {
  if (!record) return false
  if (record.isSpecified) return true
  if (record.customer && String(record.customer).trim() !== '') return true
  if (record.diameter !== null && record.diameter !== undefined && record.diameter !== '' && !isNaN(Number(record.diameter))) return true
  if (record.thickness !== null && record.thickness !== undefined && record.thickness !== '' && !isNaN(Number(record.thickness))) return true
  if (record.length !== null && record.length !== undefined && record.length !== '' && !isNaN(Number(record.length))) return true
  if (record.tonnage !== null && record.tonnage !== undefined && record.tonnage !== '' && !isNaN(Number(record.tonnage))) return true
  if (record.label && String(record.label).trim() !== '') return true
  if (record.size && String(record.size).trim() !== '') return true
  if (record.radius !== null && record.radius !== undefined && record.radius !== '' && !isNaN(Number(record.radius))) return true
  if (record.circumference !== null && record.circumference !== undefined && record.circumference !== '' && !isNaN(Number(record.circumference))) return true
  return false
}

const PRODUCTION_EDIT_ROLES = new Set(['Admin', 'Operation Manager', 'Production Supervisor', 'Quality Control'])

const SPEC_STATUS_OPTIONS = [
  { value: 'all', label: 'All Specifications' },
  { value: 'specified', label: 'Specified' },
  { value: 'unspecified', label: 'Unspecified' },
]

function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  isActive = false,
  disabled = false,
  title,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(0, options.findIndex((opt) => opt.value === value)),
  )
  const containerRef = useRef(null)
  const triggerRef = useRef(null)

  const dropdownId = id || 'production-dropdown'
  const selectedOption = options.find((opt) => opt.value === value) || options[0]
  const highlightedOption = options[highlightedIndex] || selectedOption

  const openMenu = () => {
    if (disabled) return
    const activeIndex = options.findIndex((opt) => opt.value === value)
    setHighlightedIndex(activeIndex >= 0 ? activeIndex : 0)
    setIsOpen(true)
  }

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false)
    }
  }, [disabled, isOpen])

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsOpen(false)
        triggerRef.current?.focus()
      } else if (e.key === 'Tab') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleTriggerKeyDown = (e) => {
    if (disabled) return
    if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault()
        setIsOpen(false)
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen) {
        openMenu()
      } else {
        setHighlightedIndex((prev) =>
          e.key === 'ArrowDown'
            ? (prev + 1) % options.length
            : (prev - 1 + options.length) % options.length,
        )
      }
    } else if (e.key === 'Home' && isOpen) {
      e.preventDefault()
      setHighlightedIndex(0)
    } else if (e.key === 'End' && isOpen) {
      e.preventDefault()
      setHighlightedIndex(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!isOpen) {
        openMenu()
      } else {
        if (highlightedOption) {
          onChange(highlightedOption.value)
        }
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
  }

  return (
    <div className="production-dropdown-container" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={`production-dropdown-trigger ${isActive ? 'production-filter-btn-active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={!disabled && isOpen}
        aria-activedescendant={
          !disabled && isOpen && highlightedOption ? `${dropdownId}-opt-${highlightedOption.value}` : undefined
        }
        aria-label={label}
        disabled={disabled}
        title={title}
        onClick={() => {
          if (disabled) return
          if (isOpen) setIsOpen(false)
          else openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="production-dropdown-trigger-label">{selectedOption.label}</span>
        <ChevronDown size={14} strokeWidth={2} className={`production-dropdown-chevron ${!disabled && isOpen ? 'open' : ''}`} aria-hidden="true" />
      </button>

      {!disabled && isOpen && (
        <ul
          className="production-dropdown-popover"
          role="listbox"
          aria-label={label}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isHighlighted = index === highlightedIndex
            return (
              <li
                key={option.value}
                id={`${dropdownId}-opt-${option.value}`}
                role="option"
                aria-selected={isSelected}
                className={`production-dropdown-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`.trim()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <span>{option.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
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
  const identityRef = useRef(null)
  identityRef.current = `${user?.id || ''}:${user?.role || ''}`
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const [dateFilter, setDateFilter] = useState(getManilaDateInputValue)
  const [specStatusFilter, setSpecStatusFilter] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const queryClient = useQueryClient()
  const online = useNetworkOnline()
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
    status: 'accepted', specStatus: specStatusFilter, search: debouncedSearch || undefined, page, pageSize,
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
  const setRecords = (update) => queryClient.setQueryData(key, (current) => current ? { ...current, records: typeof update === 'function' ? update(current.records || []) : update } : current, { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt })
  const setSummary = (update) => queryClient.setQueryData(key, (current) => current ? { ...current, summary: typeof update === 'function' ? update(current.summary || {}) : update } : current, { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt })
  const isLoading = query.isPending && !query.data
  const isRefreshing = query.isFetching && Boolean(query.data)
  const totalPages = Math.max(1, pagination.totalPages || 1)
  const isPageTransition = query.isPlaceholderData && query.isFetching
  const canGoPrevious = !isLoading && !isPageTransition && page > 1 && (query.isPlaceholderData || Boolean(pagination.hasPreviousPage))
  const canGoNext = !isLoading && !query.isPlaceholderData && Boolean(pagination.hasNextPage) && page < totalPages
  const loadData = () => query.refetch()
  const [error, setError] = useState(null)
  const [conflictNotice, setConflictNotice] = useState(null)
  const [announcement, setAnnouncement] = useState('')

  const [editingRecordId, setEditingRecordId] = useState(null)
  const [editForm, setEditForm] = useState({
    customer: '',
    diameter: '',
    thickness: '',
    length: '',
    pipeNumber: '',
    tonnage: '',
  })
  const [flashingRecordId, setFlashingRecordId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkForm, setBulkForm] = useState({
    customer: '',
    diameter: '',
    thickness: '',
    length: '',
    tonnage: '',
  })
  const [isConfirmingBulk, setIsConfirmingBulk] = useState(false)
  const [isApplyingBulk, setIsApplyingBulk] = useState(false)
  const [flashingRecordIds, setFlashingRecordIds] = useState(() => new Set())

  const flashTimeoutRef = useRef(null)
  const lastClickedIndexRef = useRef(null)
  const headerCheckboxRef = useRef(null)
  const lastSavedSpecRef = useRef(null)
  const bulkConfirmRef = useRef(null)

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (isConfirmingBulk && bulkConfirmRef.current) {
      bulkConfirmRef.current.focus()
    }
  }, [isConfirmingBulk])

  // Clear row selection and transient confirm state when query scope changes.
  useEffect(() => {
    lastClickedIndexRef.current = null
    setSelectedIds((prev) => (prev.size > 0 ? new Set() : prev))
    setIsConfirmingBulk(false)
  }, [dateFilter, specStatusFilter, debouncedSearch, page])

  // Clamp requested page within available pages when filtered counts shrink.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return
    const serverTotalPages = Math.max(1, query.data.pagination?.totalPages || 1)
    if (page > serverTotalPages) {
      queryClient.invalidateQueries({ queryKey: queryKeys.production.all, refetchType: 'none' })
      setPage(serverTotalPages)
    }
  }, [query.data, query.isPlaceholderData, page, queryClient])

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

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isHeaderIndeterminate
    }
  }, [isHeaderIndeterminate])

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

  const handleBulkDimensionChange = (field, value) => {
    setBulkForm((prev) => {
      const next = { ...prev, [field]: value }
      const autoTons = calculatePipeTonnage(next.diameter, next.thickness, next.length)
      next.tonnage = autoTons !== null ? String(autoTons) : ''
      return next
    })
  }

  const handleRepeatLastSpec = () => {
    const lastSpec =
      lastSavedSpecRef.current ||
      records.find(
        (r) =>
          r.isSpecified ||
          Boolean(
            (r.customer && String(r.customer).trim()) ||
            r.diameter != null ||
            r.thickness != null ||
            r.length != null ||
            r.tonnage != null,
          ),
      )
    if (!lastSpec) return
    const fallbackTonnage =
      lastSpec.tonnage !== null && lastSpec.tonnage !== undefined
        ? lastSpec.tonnage
        : calculatePipeTonnage(lastSpec.diameter, lastSpec.thickness, lastSpec.length)
    setBulkForm({
      customer: lastSpec.customer || '',
      diameter: lastSpec.diameter !== null && lastSpec.diameter !== undefined ? String(lastSpec.diameter) : '',
      thickness: lastSpec.thickness !== null && lastSpec.thickness !== undefined ? String(lastSpec.thickness) : '',
      length: lastSpec.length !== null && lastSpec.length !== undefined ? String(lastSpec.length) : '',
      tonnage: fallbackTonnage !== null && fallbackTonnage !== undefined ? String(fallbackTonnage) : '',
    })
  }

  const handleBulkApplyClick = () => {
    const hasField = Boolean(
      bulkForm.customer.trim() ||
        (bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter))) ||
        (bulkForm.thickness !== '' && !isNaN(Number(bulkForm.thickness))) ||
        (bulkForm.length !== '' && !isNaN(Number(bulkForm.length))) ||
        (bulkForm.tonnage !== '' && !isNaN(Number(bulkForm.tonnage))),
    )
    if (!hasField) {
      setError('Provide at least one specification field to update.')
      return
    }
    setError(null)
    setIsConfirmingBulk(true)
  }

  const handleBulkKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBulkApplyClick()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (isConfirmingBulk) {
        setIsConfirmingBulk(false)
      } else {
        handleDeselectAll()
      }
    }
  }

  const handleConfirmBulkApply = async () => {
    const sessionGeneration = getSessionGeneration()
    const identity = identityRef.current
    const isCurrentSession = () => mountedRef.current && identityRef.current === identity && sessionGeneration === getSessionGeneration()
    setIsConfirmingBulk(false)
    setIsApplyingBulk(true)
    setError(null)

    const targetIds = Array.from(selectedIds)
    const prevRecords = records
    const prevSummary = summary

    const newCustomer = bulkForm.customer.trim() || undefined
    const newDiameter =
      bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter)) ? Number(bulkForm.diameter) : undefined
    const newThickness =
      bulkForm.thickness !== '' && !isNaN(Number(bulkForm.thickness)) ? Number(bulkForm.thickness) : undefined
    const newLength =
      bulkForm.length !== '' && !isNaN(Number(bulkForm.length)) ? Number(bulkForm.length) : undefined
    const newTonnage =
      bulkForm.tonnage !== '' && !isNaN(Number(bulkForm.tonnage)) ? Number(bulkForm.tonnage) : undefined

    const appliedSpec = {}
    if (newCustomer !== undefined) appliedSpec.customer = newCustomer
    if (newDiameter !== undefined) appliedSpec.diameter = newDiameter
    if (newThickness !== undefined) appliedSpec.thickness = newThickness
    if (newLength !== undefined) appliedSpec.length = newLength
    if (newTonnage !== undefined) appliedSpec.tonnage = newTonnage

    void queryClient.cancelQueries({ queryKey: key, exact: true })
    let newlySpecifiedCount = 0
    let tonnageDelta = 0
    const targetSet = new Set(targetIds)
    setRecords((prev) =>
      prev.map((r) => {
        const id = r.id || r.sensorEventId
        if (!targetSet.has(id)) return r
        const effCustomer = newCustomer !== undefined ? newCustomer : r.customer
        const effDiameter = newDiameter !== undefined ? newDiameter : r.diameter
        const effThickness = newThickness !== undefined ? newThickness : r.thickness
        const effLength = newLength !== undefined ? newLength : r.length
        const effTonnage =
          newTonnage !== undefined
            ? newTonnage
            : newDiameter !== undefined || newThickness !== undefined || newLength !== undefined
              ? calculatePipeTonnage(effDiameter, effThickness, effLength)
              : (r.tonnage ?? calculatePipeTonnage(effDiameter, effThickness, effLength))
        const prevRowTonnage = r.tonnage != null && Number.isFinite(Number(r.tonnage)) ? Number(r.tonnage) : 0
        tonnageDelta += (effTonnage ?? 0) - prevRowTonnage
        const isNowSpecified = Boolean(
          (effCustomer && effCustomer.trim() !== '') ||
          effDiameter != null ||
          effThickness != null ||
          effLength != null ||
          effTonnage != null ||
          r.pipeNumber != null,
        )
        if (!r.isSpecified && isNowSpecified) {
          newlySpecifiedCount++
        }
        return {
          ...r,
          customer: effCustomer,
          diameter: effDiameter,
          thickness: effThickness,
          length: effLength,
          tonnage: effTonnage,
          isSpecified: isNowSpecified,
          specStatus: isNowSpecified ? 'specified' : 'unspecified',
        }
      }),
    )

    if (newlySpecifiedCount > 0 || tonnageDelta !== 0) {
      setSummary((prev) => ({
        ...prev,
        specifiedCount: (prev.specifiedCount ?? 0) + newlySpecifiedCount,
        unspecifiedCount: Math.max(0, (prev.unspecifiedCount ?? 0) - newlySpecifiedCount),
        totalTonnage: Math.max(0, Math.round(((prev.totalTonnage ?? 0) + tonnageDelta) * 10000) / 10000),
      }))
    }

    setFlashingRecordIds(new Set(targetIds))
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingRecordIds(new Set())
    }, 500)

    try {
      await batchUpdateFn(token, {
        sensorEventIds: targetIds,
        appliedSpec,
      })
      if (sessionGeneration === getSessionGeneration()) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.overview.all })
      }
      if (!isCurrentSession()) return

      lastSavedSpecRef.current = {
        customer: newCustomer || '',
        diameter: newDiameter ?? null,
        thickness: newThickness ?? null,
        length: newLength ?? null,
        tonnage: newTonnage ?? null,
      }
      setSelectedIds(new Set())
      setBulkForm({
        customer: '',
        diameter: '',
        thickness: '',
        length: '',
        tonnage: '',
      })
      setAnnouncement(`Applied specifications to ${targetIds.length} cuts.`)
    } catch (err) {
      if (!isCurrentSession()) {
        if (sessionGeneration === getSessionGeneration()) void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
        return
      }
      setRecords(prevRecords)
      setSummary(prevSummary)
      setError(err.message || 'Unable to update production specifications.')
    } finally {
      setIsApplyingBulk(false)
    }
  }

  const handleSpecStatusToggle = (targetSpecStatus) => {
    setSpecStatusFilter((prev) => (prev === targetSpecStatus ? 'all' : targetSpecStatus))
    setPage(1)
  }

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

  const maxProductionDate = parseProductionDate(getManilaDateInputValue())

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

  const handleStartEdit = (record) => {
    const rowId = record.id || record.sensorEventId
    setEditingRecordId(rowId)
    setConflictNotice(null)
    setError(null)
    const fallbackTonnage =
      record.tonnage !== null && record.tonnage !== undefined
        ? record.tonnage
        : calculatePipeTonnage(record.diameter, record.thickness, record.length)
    setEditForm({
      customer: record.customer ?? '',
      diameter: record.diameter !== null && record.diameter !== undefined ? String(record.diameter) : '',
      thickness: record.thickness !== null && record.thickness !== undefined ? String(record.thickness) : '',
      length: record.length !== null && record.length !== undefined ? String(record.length) : '',
      pipeNumber: record.pipeNumber !== null && record.pipeNumber !== undefined ? String(record.pipeNumber) : '',
      tonnage: fallbackTonnage !== null && fallbackTonnage !== undefined ? String(fallbackTonnage) : '',
    })
  }

  const handleCancel = () => {
    setEditingRecordId(null)
    setError(null)
    setEditForm({
      customer: '',
      diameter: '',
      thickness: '',
      length: '',
      pipeNumber: '',
      tonnage: '',
    })
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setEditForm((prev) => {
      const next = {
        ...prev,
        [name]: value,
      }
      if (name === 'diameter' || name === 'thickness' || name === 'length') {
        const autoTons = calculatePipeTonnage(next.diameter, next.thickness, next.length)
        next.tonnage = autoTons !== null ? String(autoTons) : ''
      }
      return next
    })
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
    const sessionGeneration = getSessionGeneration()
    const identity = identityRef.current
    const isCurrentSession = () => mountedRef.current && identityRef.current === identity && sessionGeneration === getSessionGeneration()
    const rowId = record.id || record.sensorEventId
    const savedEditForm = { ...editForm }
    setEditingRecordId(null)
    setError(null)

    const prevRecords = records
    const prevSummary = summary

    const newCustomer = editForm.customer?.trim() || null
    const newDiameter = editForm.diameter === '' || editForm.diameter === null ? null : Number(editForm.diameter)
    const newThickness = editForm.thickness === '' || editForm.thickness === null ? null : Number(editForm.thickness)
    const newLength = editForm.length === '' || editForm.length === null ? null : Number(editForm.length)
    const newPipeNumber =
      editForm.pipeNumber === '' || editForm.pipeNumber === null ? null : parseInt(editForm.pipeNumber, 10)
    const rawManualTonnage =
      editForm.tonnage === '' || editForm.tonnage === null || editForm.tonnage === undefined
        ? null
        : Number(editForm.tonnage)
    const manualTonnage =
      rawManualTonnage !== null && Number.isFinite(rawManualTonnage) && rawManualTonnage > 0
        ? Math.round(rawManualTonnage * 10000) / 10000
        : null
    const newTonnage = manualTonnage ?? calculatePipeTonnage(newDiameter, newThickness, newLength)

    const isNowSpecified = Boolean(
      newCustomer ||
        newDiameter != null ||
        newThickness != null ||
        newLength != null ||
        newPipeNumber != null ||
        newTonnage != null,
    )
    const wasSpecified = Boolean(record.isSpecified)

    void queryClient.cancelQueries({ queryKey: key, exact: true })
    setRecords((prev) =>
      prev.map((r) => {
        if ((r.id || r.sensorEventId) === rowId) {
          return {
            ...r,
            customer: newCustomer,
            diameter: newDiameter,
            thickness: newThickness,
            length: newLength,
            pipeNumber: newPipeNumber,
            tonnage: newTonnage,
            isSpecified: isNowSpecified,
            specStatus: isNowSpecified ? 'specified' : 'unspecified',
          }
        }
        return r
      }),
    )

    const prevRecordTonnage = record.tonnage != null && Number.isFinite(Number(record.tonnage)) ? Number(record.tonnage) : 0
    const tonnageDelta = (newTonnage ?? 0) - prevRecordTonnage
    if (wasSpecified !== isNowSpecified || tonnageDelta !== 0) {
      const specifiedDelta = !wasSpecified && isNowSpecified ? 1 : wasSpecified && !isNowSpecified ? -1 : 0
      setSummary((prev) => ({
        ...prev,
        specifiedCount: Math.max(0, (prev.specifiedCount ?? 0) + specifiedDelta),
        unspecifiedCount: Math.max(0, (prev.unspecifiedCount ?? 0) - specifiedDelta),
        totalTonnage: Math.max(0, Math.round(((prev.totalTonnage ?? 0) + tonnageDelta) * 10000) / 10000),
      }))
    }

    setFlashingRecordId(rowId)
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingRecordId(null)
    }, 500)

    const payload = {
      customer: newCustomer,
      diameter: newDiameter,
      thickness: newThickness,
      length: newLength,
      pipeNumber: newPipeNumber,
      tonnage: newTonnage,
    }

    try {
      const response = await updateFn(
        token,
        rowId,
        payload,
        record.updatedAt,
      )
      if (sessionGeneration === getSessionGeneration()) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all })
        void queryClient.invalidateQueries({ queryKey: queryKeys.overview.all })
      }
      if (!isCurrentSession()) return

      if (response?.spec) {
        setRecords((prev) =>
          prev.map((r) => {
            if ((r.id || r.sensorEventId) === rowId) {
              const updatedDiameter = response.spec.diameter != null ? Number(response.spec.diameter) : newDiameter
              const updatedThickness = response.spec.thickness != null ? Number(response.spec.thickness) : newThickness
              const updatedLength = response.spec.length != null ? Number(response.spec.length) : newLength
              const updatedPipeNumber =
                response.spec.pipe_number != null
                  ? Number(response.spec.pipe_number)
                  : response.spec.pipeNumber != null
                    ? Number(response.spec.pipeNumber)
                    : newPipeNumber
              const updatedTonnage =
                response.spec.tonnage != null
                  ? Number(response.spec.tonnage)
                  : (newTonnage ?? calculatePipeTonnage(updatedDiameter, updatedThickness, updatedLength))
              return {
                ...r,
                customer: response.spec.customer ?? newCustomer,
                diameter: updatedDiameter,
                thickness: updatedThickness,
                length: updatedLength,
                pipeNumber: updatedPipeNumber,
                tonnage: updatedTonnage,
                updatedAt: response.spec.updatedAt || response.spec.updated_at || r.updatedAt,
              }
            }
            return r
          }),
        )
      }
      if (isNowSpecified) {
        lastSavedSpecRef.current = {
          customer: response?.spec?.customer ?? newCustomer ?? '',
          diameter: response?.spec?.diameter != null ? Number(response.spec.diameter) : newDiameter,
          thickness: response?.spec?.thickness != null ? Number(response.spec.thickness) : newThickness,
          length: response?.spec?.length != null ? Number(response.spec.length) : newLength,
          tonnage:
            response?.spec?.tonnage != null
              ? Number(response.spec.tonnage)
              : newTonnage,
        }
      }
      setAnnouncement(`Specification updated for cut at ${record.recordedAt || record.timestamp}.`)
    } catch (err) {
      if (!isCurrentSession()) {
        if (sessionGeneration === getSessionGeneration()) void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
        return
      }
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
        setEditingRecordId(rowId)
        setEditForm(savedEditForm)
        setError(err.message || 'Unable to update production specification.')
      }
    }
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
      {/* Screen Reader Announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* Header Strip with Eyebrow, Main Heading, and Clean Unified KPI Pills */}
      <header className="production-header-strip"><div className="production-title-group sr-only"><p className="production-eyebrow">{`S-05 · ${getSensorLabel('S-05', 'Production Output Cutting').toUpperCase()} · SPIRAL MILL 01`}</p><h1 className="production-title">Production Output</h1></div>
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

      {/* Filter & Search Toolbar (Uniform 38px Height) */}
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

        <CustomDropdown
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

      {/* Conflict Notice */}
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
      {/* Error Notice */}
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

      {/* Contextual Bulk Action Bar */}
      {canEdit && selectedIds.size > 0 && (
        <section
          className="production-bulk-strip"
          role="region"
          aria-label="Bulk specification editor"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && isConfirmingBulk) {
              e.preventDefault()
              setIsConfirmingBulk(false)
            }
          }}
        >
          <div className="production-bulk-header">
            <div className="production-bulk-indicator">
              <span className="production-bulk-count tabular-data">
                {selectedIds.size} {selectedIds.size === 1 ? 'cut' : 'cuts'} selected
              </span>
            </div>
            <button
              type="button"
              className="production-deselect-btn"
              onClick={handleDeselectAll}
              aria-label="Deselect all cuts"
            >
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>Deselect all</span>
            </button>
          </div>

          {isConfirmingBulk ? (
            <div ref={bulkConfirmRef} tabIndex={-1} className="production-bulk-confirmation" role="alert">
              <span>
                Apply specifications to {selectedIds.size} {selectedIds.size === 1 ? 'cut' : 'cuts'}? Blank fields will keep their current values.
              </span>
              <div className="production-confirm-buttons">
                <button
                  type="button"
                  className="production-bulk-apply-btn"
                  onClick={handleConfirmBulkApply}
                  disabled={isApplyingBulk}
                >
                  {isApplyingBulk ? 'Applying...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  className="production-tool-btn production-confirm-cancel-btn"
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
                className="production-bulk-input"
                placeholder="Customer / Client"
                aria-label="Bulk customer"
                value={bulkForm.customer}
                maxLength={100}
                onChange={(e) => setBulkForm((prev) => ({ ...prev, customer: e.target.value }))}
                onKeyDown={handleBulkKeyDown}
              />
              <div className="dimension-input-wrapper production-dimension-wrapper">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Diameter (OD)"
                  aria-label="Bulk diameter"
                  step="any"
                  min="0"
                  value={bulkForm.diameter}
                  onChange={(e) => handleBulkDimensionChange('diameter', e.target.value)}
                  onKeyDown={handleBulkKeyDown}
                />
                <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
              </div>
              <div className="dimension-input-wrapper production-dimension-wrapper">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Thickness"
                  aria-label="Bulk thickness"
                  step="any"
                  min="0"
                  value={bulkForm.thickness}
                  onChange={(e) => handleBulkDimensionChange('thickness', e.target.value)}
                  onKeyDown={handleBulkKeyDown}
                />
                <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
              </div>
              <div className="dimension-input-wrapper production-dimension-wrapper">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Length"
                  aria-label="Bulk length"
                  step="any"
                  min="0"
                  value={bulkForm.length}
                  onChange={(e) => handleBulkDimensionChange('length', e.target.value)}
                  onKeyDown={handleBulkKeyDown}
                />
                <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
              </div>
              <div className="dimension-input-wrapper production-dimension-wrapper">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Tons"
                  aria-label="Bulk tonnage"
                  step="0.0001"
                  min="0"
                  value={bulkForm.tonnage}
                  onChange={(e) => setBulkForm((prev) => ({ ...prev, tonnage: e.target.value }))}
                  onKeyDown={handleBulkKeyDown}
                />
                <span className="unit-suffix production-unit-badge" aria-hidden="true">t</span>
              </div>

              <div className="production-bulk-tools">
                <button
                  type="button"
                  className="production-tool-btn"
                  title="Repeat last saved specification"
                  aria-label="Repeat last saved specification"
                  onClick={handleRepeatLastSpec}
                >
                  <Copy size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="production-bulk-apply-btn"
                  onClick={handleBulkApplyClick}
                  disabled={isApplyingBulk}
                >
                  <Check size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Apply to {selectedIds.size} {selectedIds.size === 1 ? 'cut' : 'cuts'}</span>
                </button>
              </div>
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
                      checked={isHeaderChecked}
                      disabled={isHeaderDisabled}
                      onChange={handleSelectAllToggle}
                      aria-label="Select all cuts on this page"
                      title="Select all unfilled cuts on this page"
                    />
                  </th>
                )}
                <th className="production-col-status">Status</th>
                <th>Cut Time</th>
                <th>Customer</th>
                <th className="production-col-num tabular-data">Diameter (OD mm)</th>
                <th className="production-col-num tabular-data">Thickness (mm)</th>
                <th className="production-col-num tabular-data">Length (mm)</th>
                <th className="production-col-num tabular-data">Pipe #</th>
                <th className="production-col-num tabular-data">Tons</th>
                {canEdit && <th className="production-col-action">Action</th>}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 10 : 8} className="production-empty-state">
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
                  const isSelected = selectedIds.has(rowId)

                  const rowClasses = []
                  if (isSelected) rowClasses.push('production-row-selected')
                  if (isEditing) rowClasses.push('production-row-editing')
                  if (isFlashing) rowClasses.push('production-row-flash')
                  const rowClass = rowClasses.join(' ')

                  const statusBadge = !isAccepted
                    ? <Status tone="danger" title={record.rejectionReason || 'Rejected pulse'}>Rejected</Status>
                    : <Status tone={isSpec ? 'active' : 'fault'} title={isSpec ? 'Accepted · Specified' : 'Accepted · Needs details'}>{isSpec ? 'Specified' : 'Needs details'}</Status>

                  return (
                    <tr key={rowId} className={rowClass || undefined}>
                      {canEdit && (
                        <td className="production-col-select" data-label="Select">
                          <input
                            type="checkbox"
                            className="production-checkbox"
                            checked={isSelected}
                            disabled={!isAccepted}
                            onChange={() => {}}
                            onClick={(e) => handleRowCheckboxClick(e, record, index)}
                            aria-label={`Select cut at ${record.recordedAt || record.timestamp}`}
                          />
                        </td>
                      )}
                      <td className="production-col-status" data-label="Status">
                        <div className="production-status-cell">{statusBadge}</div>
                      </td>
                      <td className="production-col-timestamp tabular-data" data-label="Cut Time">
                        {(() => {
                          const formatted = formatManilaDateTime(record.recordedAt || record.timestamp)
                          return formatted === '—' ? (
                            <span className="production-placeholder">—</span>
                          ) : (
                            formatted
                          )
                        })()}
                      </td>
                      {isEditing ? (
                        <>
                          <td data-label="Customer">
                            <input
                              type="text"
                              className="production-inline-input"
                              aria-label="Specification customer"
                              name="customer"
                              value={editForm.customer}
                              maxLength={100}
                              autoFocus
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num tabular-data" data-label="Diameter (OD mm)">
                            <input
                              type="number"
                              inputMode="decimal"
                              className="production-inline-input production-inline-num tabular-data"
                              aria-label="Specification diameter"
                              name="diameter"
                              step="any"
                              min="0"
                              value={editForm.diameter}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num tabular-data" data-label="Thickness (mm)">
                            <input
                              type="number"
                              inputMode="decimal"
                              className="production-inline-input production-inline-num tabular-data"
                              aria-label="Specification thickness"
                              name="thickness"
                              step="any"
                              min="0"
                              value={editForm.thickness}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num tabular-data" data-label="Length (mm)">
                            <input
                              type="number"
                              inputMode="decimal"
                              className="production-inline-input production-inline-num tabular-data"
                              aria-label="Specification length"
                              name="length"
                              step="any"
                              min="0"
                              value={editForm.length}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num tabular-data" data-label="Pipe #">
                            <input
                              type="number"
                              inputMode="numeric"
                              className="production-inline-input production-inline-num tabular-data"
                              aria-label="Specification pipe number"
                              name="pipeNumber"
                              step="1"
                              min="1"
                              value={editForm.pipeNumber}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                          <td className="production-col-num tabular-data" data-label="Tons">
                            <input
                              type="number"
                              inputMode="decimal"
                              className="production-inline-input production-inline-num tabular-data"
                              aria-label="Specification tonnage"
                              name="tonnage"
                              step="0.0001"
                              min="0"
                              value={editForm.tonnage}
                              onChange={handleInputChange}
                              onKeyDown={(e) => handleInputKeyDown(e, record)}
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td data-label="Customer">{record.customer || <span className="production-placeholder">—</span>}</td>
                          <td className="production-col-num tabular-data" data-label="Diameter (OD mm)">
                            {record.diameter !== null && record.diameter !== undefined ? (
                              formatDimension(record.diameter)
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data" data-label="Thickness (mm)">
                            {record.thickness !== null && record.thickness !== undefined ? (
                              formatDimension(record.thickness)
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data" data-label="Length (mm)">
                            {record.length !== null && record.length !== undefined ? (
                              formatDimension(record.length)
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data" data-label="Pipe #">
                            {record.pipeNumber !== null && record.pipeNumber !== undefined ? (
                              record.pipeNumber
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data" data-label="Tons">
                            {record.tonnage !== null && record.tonnage !== undefined ? (
                              formatTonnage(record.tonnage)
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                        </>
                      )}
                      {canEdit && (
                        <td className="production-col-action" data-label="Action">
                          {isEditing ? (
                            <div className="production-inline-actions">
                              <button
                                type="button"
                                className="production-action-btn production-save-btn"
                                aria-label="Save specification"
                                title="Save specification"
                                onClick={() => handleSave(record)}
                              >
                                <Check size={15} strokeWidth={2} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="production-action-btn production-cancel-btn"
                                aria-label="Cancel editing"
                                title="Cancel editing"
                                onClick={handleCancel}
                              >
                                <X size={15} strokeWidth={2} aria-hidden="true" />
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
                              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
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
