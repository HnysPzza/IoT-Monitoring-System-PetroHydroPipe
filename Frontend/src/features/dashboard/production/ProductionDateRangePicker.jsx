import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'

export function isSameDay(date1, date2) {
  if (!date1 || !date2) return false
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

export function parseDate(value) {
  if (!value) return undefined
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

export function formatDateInput(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getThisWeekRange(referenceDate = new Date()) {
  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
  const day = date.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { startDate: monday, endDate: sunday }
}

export function getThisMonthRange(referenceDate = new Date()) {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)
  return { startDate: start, endDate: end }
}

export function formatRangeDisplay(startDate, endDate) {
  if (!startDate) return 'All Dates'
  if (!endDate || startDate.getTime() === endDate.getTime()) {
    return startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const sMonth = startDate.toLocaleDateString('en-US', { month: 'short' })
  const eMonth = endDate.toLocaleDateString('en-US', { month: 'short' })
  const sYear = startDate.getFullYear()
  const eYear = endDate.getFullYear()
  const sDay = startDate.getDate()
  const eDay = endDate.getDate()

  if (sYear === eYear && sMonth === eMonth) {
    return `${sMonth} ${sDay} – ${eDay}, ${sYear}`
  }
  if (sYear === eYear) {
    return `${sMonth} ${sDay} – ${eMonth} ${eDay}, ${sYear}`
  }
  return `${sMonth} ${sDay}, ${sYear} – ${eMonth} ${eDay}, ${sYear}`
}

export function normalizeFilter(filter) {
  if (!filter) return { type: 'all', startDate: null, endDate: null }
  if (typeof filter === 'string') {
    return { type: 'day', startDate: filter, endDate: filter }
  }
  return filter
}

export function getDisplayLabels(rawFilter) {
  const filter = normalizeFilter(rawFilter)
  if (!filter || filter.type === 'all' || (!filter.startDate && !filter.date)) {
    return {
      eyebrow: 'DATE',
      value: 'All Dates',
    }
  }

  if (filter.type === 'week') {
    const start = parseDate(filter.startDate)
    const end = parseDate(filter.endDate)
    return {
      eyebrow: 'WEEKLY',
      value: formatRangeDisplay(start, end),
    }
  }

  if (filter.type === 'month') {
    const start = parseDate(filter.startDate)
    return {
      eyebrow: 'MONTHLY',
      value: start ? start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'All Dates',
    }
  }

  const start = parseDate(filter.startDate || filter.date)
  const end = parseDate(filter.endDate || filter.startDate || filter.date)

  if (!start) {
    return { eyebrow: 'DATE', value: 'All Dates' }
  }

  if (!end || start.getTime() === end.getTime()) {
    return {
      eyebrow: 'DATE',
      value: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }
  }

  return {
    eyebrow: 'RANGE',
    value: formatRangeDisplay(start, end),
  }
}

const WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const PRESETS = [
  { id: 'all', label: 'All Dates' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'custom', label: 'Custom Range' },
]

export default function ProductionDateRangePicker({
  value,
  onChange,
  maxDate,
  accessibleLabel = 'Select production date',
  triggerAriaLabel = 'Filter by date',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draftPreset, setDraftPreset] = useState('today')
  const [draftStartDate, setDraftStartDate] = useState(null)
  const [draftEndDate, setDraftEndDate] = useState(null)
  const [isSelectingRange, setIsSelectingRange] = useState(false)
  const [hoverDate, setHoverDate] = useState(null)
  const [hoverWeek, setHoverWeek] = useState(null)

  const maxDateObj = parseDate(maxDate)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)

  const normalizedValue = normalizeFilter(value)
  const activeLabels = getDisplayLabels(normalizedValue)
  const hasActiveFilter = Boolean(normalizedValue && normalizedValue.type !== 'all' && (normalizedValue.startDate || normalizedValue.date))

  const [viewMonth, setViewMonth] = useState(() => {
    const initialDate = parseDate(normalizedValue?.startDate || normalizedValue?.date) || new Date()
    return new Date(initialDate.getFullYear(), initialDate.getMonth(), 1)
  })

  const [viewYear, setViewYear] = useState(() => {
    const initialDate = parseDate(normalizedValue?.startDate || normalizedValue?.date) || new Date()
    return initialDate.getFullYear()
  })

  // Synchronize draft state whenever popover opens
  useEffect(() => {
    if (!isOpen) return

    const norm = normalizeFilter(value)
    if (!norm || norm.type === 'all' || (!norm.startDate && !norm.date)) {
      setDraftPreset('all')
      setDraftStartDate(null)
      setDraftEndDate(null)
    } else {
      const start = parseDate(norm.startDate || norm.date)
      const end = parseDate(norm.endDate || norm.startDate || norm.date)
      setDraftStartDate(start)
      setDraftEndDate(end)
      setDraftPreset(norm.type || 'custom')
      if (start) {
        setViewMonth(new Date(start.getFullYear(), start.getMonth(), 1))
        setViewYear(start.getFullYear())
      }
    }
    setIsSelectingRange(false)
    setHoverDate(null)
    setHoverWeek(null)
  }, [isOpen, value])

  // Handle outside click & escape key
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
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleTriggerClick = () => {
    setIsOpen((prev) => !prev)
  }

  const handleInlineClear = (e) => {
    e.stopPropagation()
    onChange?.({
      type: 'all',
      startDate: null,
      endDate: null,
    })
    setIsOpen(false)
  }

  const handlePresetClick = (presetId) => {
    const today = new Date()
    if (presetId === 'all') {
      setDraftPreset('all')
      setDraftStartDate(null)
      setDraftEndDate(null)
      setIsSelectingRange(false)
      setHoverDate(null)
      setHoverWeek(null)
    } else if (presetId === 'today') {
      setDraftPreset('today')
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      setDraftStartDate(todayDate)
      setDraftEndDate(todayDate)
      setViewMonth(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1))
      setViewYear(todayDate.getFullYear())
      setIsSelectingRange(false)
      setHoverDate(null)
      setHoverWeek(null)
    } else if (presetId === 'week') {
      setDraftPreset('week')
      const ref = draftStartDate || today
      const { startDate, endDate } = getThisWeekRange(ref)
      setDraftStartDate(startDate)
      setDraftEndDate(endDate)
      setViewMonth(new Date(ref.getFullYear(), ref.getMonth(), 1))
      setViewYear(ref.getFullYear())
      setIsSelectingRange(false)
      setHoverDate(null)
      setHoverWeek(null)
    } else if (presetId === 'month') {
      setDraftPreset('month')
      const ref = draftStartDate || today
      const { startDate, endDate } = getThisMonthRange(ref)
      setDraftStartDate(startDate)
      setDraftEndDate(endDate)
      setViewYear(ref.getFullYear())
      setIsSelectingRange(false)
      setHoverDate(null)
      setHoverWeek(null)
    } else if (presetId === 'custom') {
      setDraftPreset('custom')
      setIsSelectingRange(false)
      setHoverDate(null)
      setHoverWeek(null)
    }
  }

  const handleDayClick = (cellDate) => {
    if (maxDateObj && cellDate > maxDateObj) return

    if (draftPreset === 'week') {
      const { startDate, endDate } = getThisWeekRange(cellDate)
      setDraftStartDate(startDate)
      setDraftEndDate(endDate)
      setIsSelectingRange(false)
      setHoverWeek(null)
      return
    }

    if (!isSelectingRange) {
      // First click: sets startDate
      setDraftStartDate(cellDate)
      setDraftEndDate(cellDate)
      setIsSelectingRange(true)
      setHoverDate(null)
      setDraftPreset('custom')
    } else {
      // Second click: sets endDate
      let finalStart = draftStartDate
      let finalEnd = cellDate

      if (cellDate < draftStartDate) {
        finalStart = cellDate
        finalEnd = draftStartDate
      }

      setDraftStartDate(finalStart)
      setDraftEndDate(finalEnd)
      setIsSelectingRange(false)
      setHoverDate(null)
      setDraftPreset('custom')
    }
  }

  const handleMonthSelect = (mIdx) => {
    const start = new Date(viewYear, mIdx, 1)
    if (maxDateObj && start > maxDateObj) return
    const end = new Date(viewYear, mIdx + 1, 0)
    setDraftStartDate(start)
    setDraftEndDate(end)
    setDraftPreset('month')
  }

  const handleReset = () => {
    setDraftPreset('all')
    setDraftStartDate(null)
    setDraftEndDate(null)
    setIsSelectingRange(false)
    setHoverDate(null)
    setHoverWeek(null)
  }

  const handleApply = () => {
    if (maxDateObj && draftPreset !== 'all' && (draftStartDate > maxDateObj || (draftPreset === 'custom' && draftEndDate > maxDateObj))) return
    if (draftPreset === 'all' || !draftStartDate) {
      onChange?.({
        type: 'all',
        startDate: null,
        endDate: null,
      })
    } else if (draftPreset === 'week') {
      onChange?.({
        type: 'week',
        startDate: formatDateInput(draftStartDate),
        endDate: formatDateInput(draftEndDate),
      })
    } else if (draftPreset === 'month') {
      onChange?.({
        type: 'month',
        startDate: formatDateInput(draftStartDate),
        endDate: formatDateInput(draftEndDate),
      })
    } else if (draftPreset === 'today') {
      onChange?.({
        type: 'today',
        startDate: formatDateInput(draftStartDate),
        endDate: formatDateInput(draftEndDate),
      })
    } else {
      const isSingle = !draftEndDate || isSameDay(draftStartDate, draftEndDate)
      onChange?.({
        type: isSingle ? 'day' : 'range',
        startDate: formatDateInput(draftStartDate),
        endDate: formatDateInput(draftEndDate || draftStartDate),
      })
    }
    setIsOpen(false)
  }

  // Calendar calculations
  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const firstDayIndex = new Date(year, month, 1).getDay()
  const totalDays = new Date(year, month + 1, 0).getDate()
  const monthTitle = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })


  // Determine active draft footer label
  let footerSelectionLabel = 'All Dates'
  if (draftPreset === 'month' && draftStartDate) {
    footerSelectionLabel = draftStartDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } else if (draftStartDate && draftEndDate) {
    footerSelectionLabel = formatRangeDisplay(draftStartDate, draftEndDate)
  } else if (draftStartDate) {
    footerSelectionLabel = formatRangeDisplay(draftStartDate, draftStartDate)
  }

  return (
    <div className="production-date-wrapper" ref={containerRef}>
      <div className={`production-date-trigger-container ${isOpen ? 'is-open' : ''}`}>
        <button
          ref={triggerRef}
          type="button"
          className="trend-calendar-trigger production-date-trigger-btn"
          aria-label={triggerAriaLabel}
          aria-expanded={isOpen}
          onClick={handleTriggerClick}
        >
          <CalendarDays size={16} aria-hidden="true" />
          <span className="production-date-copy">
            <span className="production-date-eyebrow">{activeLabels.eyebrow}</span>
            <span className="production-date-value">{activeLabels.value}</span>
          </span>
        </button>

        {hasActiveFilter ? (
          <button
            type="button"
            className="production-date-clear-inline"
            aria-label="Clear date filter"
            title="Clear date filter"
            onClick={handleInlineClear}
          >
            <X size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="button"
          className="production-date-chevron-btn"
          aria-hidden="true"
          tabIndex={-1}
          onClick={handleTriggerClick}
        >
          <ChevronDown className={`production-date-chevron ${isOpen ? 'is-open' : ''}`} size={14} />
        </button>
      </div>

      {isOpen ? (
        <div
          role="dialog"
          aria-label={accessibleLabel}
          className="production-date-popover"
        >
          <div className="production-popover-body">
            {/* Left Sidebar: Quick Presets */}
            <div className="production-popover-sidebar">
              {PRESETS.map((p) => {
                const isActive = draftPreset === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`production-preset-btn ${isActive ? 'is-active' : ''}`}
                    onClick={() => handlePresetClick(p.id)}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>

            {/* Right Area: Calendar or Month Grid */}
            <div className="production-popover-calendar">
              {draftPreset === 'month' ? (
                <div>
                  <div className="production-calendar-header">
                    <button
                      type="button"
                      className="production-calendar-nav-btn"
                      aria-label="Previous year"
                      onClick={() => setViewYear((y) => y - 1)}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <strong>{viewYear}</strong>
                    <button
                      type="button"
                      className="production-calendar-nav-btn"
                      aria-label="Next year"
                      onClick={() => setViewYear((y) => y + 1)}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="production-calendar-months-grid">
                    {MONTH_NAMES.map((mName, mIdx) => {
                      const isMonthDisabled = Boolean(
                        maxDateObj && new Date(viewYear, mIdx, 1) > maxDateObj,
                      )
                      const isMonthSelected = Boolean(
                        draftStartDate &&
                          draftStartDate.getFullYear() === viewYear &&
                          draftStartDate.getMonth() === mIdx &&
                          draftPreset === 'month',
                      )

                      return (
                        <button
                          key={mName}
                          type="button"
                          disabled={isMonthDisabled}
                          className={`production-calendar-month-btn ${isMonthSelected ? 'is-selected' : ''} ${isMonthDisabled && !isMonthSelected ? 'is-future' : ''}`}
                          onClick={() => handleMonthSelect(mIdx)}
                        >
                          {mName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="production-calendar-header">
                    <button
                      type="button"
                      className="production-calendar-nav-btn"
                      aria-label="Previous month"
                      onClick={() => setViewMonth(new Date(year, month - 1, 1))}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <strong>{monthTitle}</strong>
                    <button
                      type="button"
                      className="production-calendar-nav-btn"
                      aria-label="Next month"

                      onClick={() => setViewMonth(new Date(year, month + 1, 1))}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="production-calendar-weekdays">
                    {WEEKDAY_NAMES.map((w) => (
                      <span key={w} className="production-calendar-weekday">
                        {w}
                      </span>
                    ))}
                  </div>

                  <div
                    className="production-calendar-grid"
                    onMouseLeave={() => {
                      setHoverDate(null)
                      setHoverWeek(null)
                    }}
                  >
                    {Array.from({ length: firstDayIndex }).map((_, idx) => (
                      <div key={`empty-${idx}`} className="production-calendar-cell-empty" />
                    ))}

                    {Array.from({ length: totalDays }, (_, i) => i + 1).map((dayNum) => {
                      const cellDate = new Date(year, month, dayNum)
                      const isDisabled = Boolean(maxDateObj && cellDate > maxDateObj)

                      let isStart = false
                      let isEnd = false
                      let isInRange = false
                      let isHoverRange = false
                      let isWeekSelected = false

                      if (draftPreset === 'week' && hoverWeek) {
                        if (cellDate >= hoverWeek.startDate && cellDate <= hoverWeek.endDate) {
                          isHoverRange = true
                        }
                      }

                      if (draftPreset === 'week' && draftStartDate && draftEndDate) {
                        if (cellDate >= draftStartDate && cellDate <= draftEndDate) {
                          isWeekSelected = true
                          isStart = isSameDay(cellDate, draftStartDate)
                          isEnd = isSameDay(cellDate, draftEndDate)
                        }
                      } else if (draftStartDate && draftEndDate) {
                        isStart = isSameDay(cellDate, draftStartDate)
                        isEnd = isSameDay(cellDate, draftEndDate)
                        isInRange = cellDate > draftStartDate && cellDate < draftEndDate
                      } else if (draftStartDate) {
                        isStart = isSameDay(cellDate, draftStartDate)
                        if (hoverDate) {
                          const rangeMin = draftStartDate < hoverDate ? draftStartDate : hoverDate
                          const rangeMax = draftStartDate < hoverDate ? hoverDate : draftStartDate
                          isEnd = isSameDay(cellDate, hoverDate)
                          isHoverRange = cellDate > rangeMin && cellDate < rangeMax
                        }
                      }

                      const classNames = [
                        'production-calendar-day',
                        (isStart || isEnd || isWeekSelected) ? 'is-selected' : '',
                        isWeekSelected ? 'is-week-selected' : '',
                        (isWeekSelected && isStart) ? 'is-week-start' : '',
                        (isWeekSelected && isEnd) ? 'is-week-end' : '',
                        isInRange ? 'is-in-range' : '',
                        isHoverRange ? 'is-hover-range' : '',
                        isDisabled && !isStart && !isEnd ? 'is-future' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')

                      return (
                        <button
                          key={dayNum}
                          type="button"
                          className={classNames}
                          disabled={isDisabled}
                          onClick={() => handleDayClick(cellDate)}
                          onMouseEnter={() => {
                            if (draftPreset === 'week') {
                              const { startDate, endDate } = getThisWeekRange(cellDate)
                              setHoverWeek({ startDate, endDate })
                            } else if (isSelectingRange) {
                              setHoverDate(cellDate)
                            }
                          }}
                          aria-label={cellDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        >
                          {dayNum}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Bar */}
          <div className="production-popover-footer">
            <span className="production-popover-selection-label">
              {footerSelectionLabel}
            </span>
            <div className="production-popover-actions">
              <button
                type="button"
                className="production-popover-reset-btn"
                onClick={handleReset}
              >
                Reset
              </button>
              <button
                type="button"
                className="production-popover-apply-btn"
                onClick={handleApply}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
