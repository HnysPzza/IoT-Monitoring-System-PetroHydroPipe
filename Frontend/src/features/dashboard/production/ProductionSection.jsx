import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  Copy,
  Pencil,
  RotateCw,
  Search,
  Tag,
  X,
} from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { getSensorLabel } from '../../../shared/constants/sensorIdentity.js'
import TrendCalendarControl from '../overview/TrendCalendarControl.jsx'
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
  if (value === null || value === undefined || isNaN(Number(value))) return null
  return Number(value).toFixed(2)
}

function formatTonnage(value) {
  if (value === null || value === undefined || isNaN(Number(value))) return null
  return Number(value).toFixed(4)
}

function calculatePipeTonnage(diameter, thickness, length) {
  if (diameter == null || thickness == null || length == null) return null
  const d = Number(diameter)
  const t = Number(thickness)
  const l = Number(length)
  if (!Number.isFinite(d) || !Number.isFinite(t) || !Number.isFinite(l)) return null
  if (d <= 0 || t <= 0 || l <= 0 || d <= t) return null
  const weightKgPerMeter = (d - t) * t * 0.02466
  const totalWeightTons = (weightKgPerMeter * l) / 1000000
  return Math.round(totalWeightTons * 10000) / 10000
}

export function hasInformation(record) {
  if (!record) return false
  if (record.isSpecified) return true
  if (record.customer && String(record.customer).trim() !== '') return true
  if (record.diameter !== null && record.diameter !== undefined && record.diameter !== '' && !isNaN(Number(record.diameter))) return true
  if (record.thickness !== null && record.thickness !== undefined && record.thickness !== '' && !isNaN(Number(record.thickness))) return true
  if (record.length !== null && record.length !== undefined && record.length !== '' && !isNaN(Number(record.length))) return true
  if (record.label && String(record.label).trim() !== '') return true
  if (record.size && String(record.size).trim() !== '') return true
  if (record.radius !== null && record.radius !== undefined && record.radius !== '' && !isNaN(Number(record.radius))) return true
  if (record.circumference !== null && record.circumference !== undefined && record.circumference !== '' && !isNaN(Number(record.circumference))) return true
  return false
}

const PRODUCTION_EDIT_ROLES = new Set(['Admin', 'Operation Manager', 'Production Supervisor'])

const CUT_STATUS_OPTIONS = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All Statuses' },
]

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
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)

  const selectedOption = options.find((opt) => opt.value === value) || options[0]

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
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
      } else {
        const currentIndex = options.findIndex((opt) => opt.value === value)
        const nextIndex =
          e.key === 'ArrowDown'
            ? (currentIndex + 1) % options.length
            : (currentIndex - 1 + options.length) % options.length
        onChange(options[nextIndex].value)
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setIsOpen((prev) => !prev)
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
        aria-expanded={isOpen}
        aria-label={label}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="production-dropdown-trigger-label">{selectedOption.label}</span>
        <ChevronDown size={14} strokeWidth={2} className={`production-dropdown-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <ul
          className="production-dropdown-popover"
          role="listbox"
          aria-label={label}
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                className={`production-dropdown-item ${isSelected ? 'selected' : ''}`}
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
  const [announcement, setAnnouncement] = useState('')

  const [editingRecordId, setEditingRecordId] = useState(null)
  const [editForm, setEditForm] = useState({
    customer: '',
    diameter: '',
    thickness: '',
    length: '',
    pipeNumber: '',
  })
  const [flashingRecordId, setFlashingRecordId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkForm, setBulkForm] = useState({
    customer: '',
    diameter: '',
    thickness: '',
    length: '',
  })
  const [isConfirmingBulk, setIsConfirmingBulk] = useState(false)
  const [isApplyingBulk, setIsApplyingBulk] = useState(false)
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

  const handleRepeatLastSpec = () => {
    const lastSpec = records.find(
      (r) =>
        r.isSpecified ||
        Boolean(
          (r.customer && String(r.customer).trim()) ||
          r.diameter != null ||
          r.thickness != null ||
          r.length != null,
        ),
    )
    if (!lastSpec) return
    setBulkForm({
      customer: lastSpec.customer || '',
      diameter: lastSpec.diameter !== null && lastSpec.diameter !== undefined ? String(lastSpec.diameter) : '',
      thickness: lastSpec.thickness !== null && lastSpec.thickness !== undefined ? String(lastSpec.thickness) : '',
      length: lastSpec.length !== null && lastSpec.length !== undefined ? String(lastSpec.length) : '',
    })
  }

  const handleBulkApplyClick = () => {
    const hasField = Boolean(
      bulkForm.customer.trim() ||
        (bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter))) ||
        (bulkForm.thickness !== '' && !isNaN(Number(bulkForm.thickness))) ||
        (bulkForm.length !== '' && !isNaN(Number(bulkForm.length))),
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

    const newCustomer = bulkForm.customer.trim() || undefined
    const newDiameter =
      bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter)) ? Number(bulkForm.diameter) : undefined
    const newThickness =
      bulkForm.thickness !== '' && !isNaN(Number(bulkForm.thickness)) ? Number(bulkForm.thickness) : undefined
    const newLength =
      bulkForm.length !== '' && !isNaN(Number(bulkForm.length)) ? Number(bulkForm.length) : undefined

    const appliedSpec = {}
    if (newCustomer !== undefined) appliedSpec.customer = newCustomer
    if (newDiameter !== undefined) appliedSpec.diameter = newDiameter
    if (newThickness !== undefined) appliedSpec.thickness = newThickness
    if (newLength !== undefined) appliedSpec.length = newLength

    let newlySpecifiedCount = 0
    const targetSet = new Set(targetIds)
    setRecords((prev) =>
      prev.map((r) => {
        const id = r.id || r.sensorEventId
        if (!targetSet.has(id)) return r
        const effCustomer = newCustomer !== undefined ? newCustomer : r.customer
        const effDiameter = newDiameter !== undefined ? newDiameter : r.diameter
        const effThickness = newThickness !== undefined ? newThickness : r.thickness
        const effLength = newLength !== undefined ? newLength : r.length
        const effTonnage = calculatePipeTonnage(effDiameter, effThickness, effLength)
        const isNowSpecified = Boolean(
          (effCustomer && effCustomer.trim() !== '') ||
          effDiameter != null ||
          effThickness != null ||
          effLength != null ||
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
        customer: '',
        diameter: '',
        thickness: '',
        length: '',
      })
      setAnnouncement(`Applied specifications to ${targetIds.length} cuts.`)
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

  const selectedProductionDate = parseProductionDate(dateFilter)
  const maxProductionDate = parseProductionDate(getManilaDateInputValue())
  const dateRangeLabel = selectedProductionDate ? formatProductionDateLabel(selectedProductionDate) : 'All Dates'

  const handleCalendarDateChange = (date) => {
    if (!date) return
    setDateFilter(formatProductionDateInput(date))
    setPage(1)
  }

  const handleClearDateFilter = () => {
    setDateFilter('')
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
      customer: record.customer ?? '',
      diameter: record.diameter !== null && record.diameter !== undefined ? String(record.diameter) : '',
      thickness: record.thickness !== null && record.thickness !== undefined ? String(record.thickness) : '',
      length: record.length !== null && record.length !== undefined ? String(record.length) : '',
      pipeNumber: record.pipeNumber !== null && record.pipeNumber !== undefined ? String(record.pipeNumber) : '',
    })
  }

  const handleCancel = () => {
    setEditingRecordId(null)
    setEditForm({
      customer: '',
      diameter: '',
      thickness: '',
      length: '',
      pipeNumber: '',
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

    const newCustomer = editForm.customer?.trim() || null
    const newDiameter = editForm.diameter === '' || editForm.diameter === null ? null : Number(editForm.diameter)
    const newThickness = editForm.thickness === '' || editForm.thickness === null ? null : Number(editForm.thickness)
    const newLength = editForm.length === '' || editForm.length === null ? null : Number(editForm.length)
    const newPipeNumber =
      editForm.pipeNumber === '' || editForm.pipeNumber === null ? null : parseInt(editForm.pipeNumber, 10)
    const newTonnage = calculatePipeTonnage(newDiameter, newThickness, newLength)

    const isNowSpecified = Boolean(
      newCustomer ||
        newDiameter != null ||
        newThickness != null ||
        newLength != null ||
        newPipeNumber != null,
    )
    const wasSpecified = Boolean(record.isSpecified)

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
      customer: newCustomer,
      diameter: newDiameter,
      thickness: newThickness,
      length: newLength,
      pipeNumber: newPipeNumber,
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
              const updatedDiameter = response.spec.diameter != null ? Number(response.spec.diameter) : newDiameter
              const updatedThickness = response.spec.thickness != null ? Number(response.spec.thickness) : newThickness
              const updatedLength = response.spec.length != null ? Number(response.spec.length) : newLength
              const updatedPipeNumber =
                response.spec.pipe_number != null
                  ? Number(response.spec.pipe_number)
                  : response.spec.pipeNumber != null
                    ? Number(response.spec.pipeNumber)
                    : newPipeNumber
              return {
                ...r,
                customer: response.spec.customer ?? newCustomer,
                diameter: updatedDiameter,
                thickness: updatedThickness,
                length: updatedLength,
                pipeNumber: updatedPipeNumber,
                tonnage: calculatePipeTonnage(updatedDiameter, updatedThickness, updatedLength),
                updatedAt: response.spec.updatedAt || response.spec.updated_at || r.updatedAt,
              }
            }
            return r
          }),
        )
      }
      setAnnouncement(`Specification updated for cut at ${record.recordedAt || record.timestamp}.`)
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

  const sensorLabel = getSensorLabel('S-05', 'Production Output Cutting')

  return (
    <div className="production-workspace">
      {/* Screen Reader Announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* Header Strip with Eyebrow, Main Heading, and Clean Unified KPI Pills */}
      <header className="production-header-strip">
        <div className="production-title-group">
          <p className="production-eyebrow">{`S-05 · ${sensorLabel.toUpperCase()} · SPIRAL MILL 01`}</p>
          <h1 className="production-title">Production Logs</h1>
        </div>

        {/* Clean Unified KPI Pills on right */}
        <div className="production-kpi-strip" role="region" aria-label="Production Summary Metrics">
          <button
            type="button"
            className="production-kpi-pill accepted"
            title="Total Accepted Cuts"
            aria-label="Total accepted cuts"
            onClick={() => {
              setStatusFilter('accepted')
              setSpecStatusFilter('all')
              setPage(1)
            }}
          >
            <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
            <strong className="production-kpi-value tabular-data">{summary.totalAccepted ?? 0}</strong>
            <span className="production-kpi-label">Accepted</span>
          </button>

          <button
            type="button"
            className={`production-kpi-pill specified ${specStatusFilter === 'specified' ? 'production-kpi-active' : ''}`}
            title="Specified Cuts"
            aria-label="Filter specified cuts"
            aria-pressed={specStatusFilter === 'specified'}
            onClick={() => {
              setSpecStatusFilter((prev) => (prev === 'specified' ? 'all' : 'specified'))
              setPage(1)
            }}
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
            onClick={handleToggleUnspecified}
          >
            <CircleDashed size={14} strokeWidth={2} aria-hidden="true" />
            <strong className="production-kpi-value tabular-data">{summary.unspecifiedCount ?? 0}</strong>
            <span className="production-kpi-label">Unspecified</span>
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
            className="production-square-btn"
            style={{ width: '28px', height: '28px', border: 'none', background: 'transparent', boxShadow: 'none' }}
            onClick={() => setConflictNotice(null)}
            aria-label="Dismiss notice"
            title="Dismiss notice"
          >
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
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

      {/* Filter & Search Toolbar (Uniform 36px Height) */}
      <section className="production-filter-strip" aria-label="Production Log Filters">
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

        <div className="production-date-wrapper">
          <TrendCalendarControl
            mode="day"
            accessibleLabel="Select production date"
            triggerAriaLabel="Filter by date"
            triggerLabel="DATE"
            selectedDate={selectedProductionDate}
            maxDate={maxProductionDate}
            rangeLabel={dateRangeLabel}
            onDateChange={handleCalendarDateChange}
            popoverClassName="production-calendar-popover"
          />
          {dateFilter ? (
            <button
              type="button"
              className="production-square-btn production-date-clear-btn"
              aria-label="Clear date filter"
              title="Clear date filter"
              onClick={handleClearDateFilter}
            >
              <X size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <CustomDropdown
          id="production-status-filter"
          label="Filter by cut status"
          value={statusFilter}
          options={CUT_STATUS_OPTIONS}
          onChange={(newVal) => {
            setStatusFilter(newVal)
            setPage(1)
          }}
          isActive={statusFilter !== 'accepted'}
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
          className={`production-square-btn ${specStatusFilter === 'unspecified' ? 'production-filter-btn-active' : ''}`}
          aria-label="Toggle unspecified cuts filter"
          title={specStatusFilter === 'unspecified' ? 'Show all specifications' : 'Show unspecified cuts only'}
          onClick={handleToggleUnspecified}
        >
          <CircleDashed size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="production-square-btn"
          aria-label="Refresh production logs"
          title="Refresh production logs"
          disabled={isLoading}
          onClick={() => loadData({ silent: true })}
        >
          <RotateCw size={15} strokeWidth={1.75} className={isRefreshing ? 'spin-icon' : ''} aria-hidden="true" />
        </button>
      </section>

      {/* Contextual Bulk Action Bar */}
      {canEdit && selectedIds.size > 0 && (
        <section className="production-bulk-strip" role="region" aria-label="Bulk specification editor">
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
            <div className="production-bulk-confirmation" role="alert">
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
                  className="production-tool-btn"
                  style={{ width: 'auto', padding: '0 0.75rem', height: '34px' }}
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
              />
              <div className="dimension-input-wrapper production-dimension-wrapper">
                <input
                  type="number"
                  placeholder="Diameter (OD)"
                  aria-label="Bulk diameter"
                  step="any"
                  min="0"
                  value={bulkForm.diameter}
                  onChange={(e) => setBulkForm((prev) => ({ ...prev, diameter: e.target.value }))}
                />
                <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
              </div>
              <div className="dimension-input-wrapper production-dimension-wrapper">
                <input
                  type="number"
                  placeholder="Thickness"
                  aria-label="Bulk thickness"
                  step="any"
                  min="0"
                  value={bulkForm.thickness}
                  onChange={(e) => setBulkForm((prev) => ({ ...prev, thickness: e.target.value }))}
                />
                <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
              </div>
              <div className="dimension-input-wrapper production-dimension-wrapper">
                <input
                  type="number"
                  placeholder="Length"
                  aria-label="Bulk length"
                  step="any"
                  min="0"
                  value={bulkForm.length}
                  onChange={(e) => setBulkForm((prev) => ({ ...prev, length: e.target.value }))}
                />
                <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
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

                  let statusBadge = null
                  if (!isAccepted) {
                    statusBadge = (
                      <span
                        className="production-status-badge red"
                        title={record.rejectionReason || 'Rejected pulse'}
                        aria-label={record.rejectionReason || 'Rejected pulse'}
                      >
                        <CircleSlash size={14} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                    )
                  } else if (isSpec) {
                    statusBadge = (
                      <span
                        className="production-status-badge emerald"
                        title="Accepted · Specified"
                        aria-label="Accepted · Specified"
                      >
                        <CheckCircle2 size={14} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                    )
                  } else {
                    statusBadge = (
                      <span
                        className="production-status-badge amber"
                        title="Accepted · Needs details"
                        aria-label="Accepted · Needs details"
                      >
                        <CircleDashed size={14} strokeWidth={1.75} aria-hidden="true" />
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
                            checked={isSelected}
                            disabled={!isAccepted}
                            onChange={() => {}}
                            onClick={(e) => handleRowCheckboxClick(e, record, index)}
                            aria-label={`Select cut at ${record.recordedAt || record.timestamp}`}
                          />
                        </td>
                      )}
                      <td className="production-col-status">
                        <div className="production-status-cell">{statusBadge}</div>
                      </td>
                      <td className="production-col-timestamp tabular-data">
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
                          <td>
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
                          <td className="production-col-num tabular-data">
                            <input
                              type="number"
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
                          <td className="production-col-num tabular-data">
                            <input
                              type="number"
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
                          <td className="production-col-num tabular-data">
                            <input
                              type="number"
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
                          <td className="production-col-num tabular-data">
                            <input
                              type="number"
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
                          <td className="production-col-num tabular-data">
                            {(() => {
                              const calculatedTonnage = calculatePipeTonnage(
                                editForm.diameter,
                                editForm.thickness,
                                editForm.length,
                              )
                              return calculatedTonnage != null ? (
                                formatTonnage(calculatedTonnage)
                              ) : (
                                <span className="production-placeholder">—</span>
                              )
                            })()}
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{record.customer || <span className="production-placeholder">—</span>}</td>
                          <td className="production-col-num tabular-data">
                            {record.diameter !== null && record.diameter !== undefined ? (
                              formatDimension(record.diameter)
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data">
                            {record.thickness !== null && record.thickness !== undefined ? (
                              formatDimension(record.thickness)
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data">
                            {record.length !== null && record.length !== undefined ? (
                              formatDimension(record.length)
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data">
                            {record.pipeNumber !== null && record.pipeNumber !== undefined ? (
                              record.pipeNumber
                            ) : (
                              <span className="production-placeholder">—</span>
                            )}
                          </td>
                          <td className="production-col-num tabular-data">
                            {record.tonnage !== null && record.tonnage !== undefined ? (
                              formatTonnage(record.tonnage)
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
            Page {pagination.page} of {pagination.totalPages || 1} · {pagination.total} records
          </div>
          <div className="production-pagination-actions">
            <button
              type="button"
              className="production-pagination-btn"
              disabled={!pagination.hasPreviousPage}
              onClick={handlePreviousPage}
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="production-pagination-btn"
              disabled={!pagination.hasNextPage}
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
