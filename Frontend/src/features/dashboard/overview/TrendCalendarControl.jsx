import { useEffect, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import '../../../shared/components/ui/calendar.css'

export function normalizeCalendarSelection(mode, date) {
  if (!date) return date

  if (mode === 'month') {
    return new Date(date.getFullYear(), date.getMonth(), 1)
  }

  if (mode === 'week') {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    monday.setDate(monday.getDate() - (monday.getDay() || 7) + 1)
    return monday
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date, amount) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + amount)
  return nextDate
}

function startOfWeek(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - (monday.getDay() || 7) + 1)
  return monday
}

function formatWeekDate(date) {
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatWeekLabel(weekStart) {
  return `${formatWeekDate(weekStart)} - ${formatWeekDate(addDays(weekStart, 6))}`
}

function getMonthWeeks(date) {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const weeks = []
  let weekStart = startOfWeek(monthStart)

  while (weekStart <= monthEnd) {
    weeks.push(weekStart)
    weekStart = addDays(weekStart, 7)
  }

  return weeks
}

function getDaysForMonth(viewDate) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)

  const startMonday = startOfWeek(monthStart)
  const endSunday = addDays(startOfWeek(monthEnd), 6)

  const days = []
  let current = new Date(startMonday)
  while (current <= endSunday) {
    days.push(new Date(current))
    current = addDays(current, 1)
  }
  return days
}

function getDayAriaLabel(date) {
  const day = date.getDate()
  let suffix = 'th'
  if (day < 11 || day > 13) {
    const lastDigit = day % 10
    if (lastDigit === 1) suffix = 'st'
    else if (lastDigit === 2) suffix = 'nd'
    else if (lastDigit === 3) suffix = 'rd'
  }
  const monthName = date.toLocaleDateString('en-US', { month: 'long' })
  const year = date.getFullYear()
  return `${monthName} ${day}${suffix}, ${year}`
}

function isSameDay(d1, d2) {
  if (!d1 || !d2) return false
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

function normalizeMode(m) {
  if (m === 'day' || m === 'today' || m === 'daily') return 'today'
  if (m === 'week' || m === 'weekly') return 'week'
  if (m === 'month' || m === 'monthly') return 'month'
  return 'today'
}

const WEEKDAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const DEFAULT_PRESETS = [
  { id: 'today', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
]

export default function TrendCalendarControl({
  mode = 'today',
  selectedDate,
  maxDate,
  rangeLabel,
  onDateChange,
  onModeChange,
  accessibleLabel: accessibleLabelOverride,
  triggerAriaLabel,
  triggerLabel = 'SELECTED PERIOD',
  popoverClassName,
  presets = DEFAULT_PRESETS,
  showPresets = true,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draftMode, setDraftMode] = useState(mode)
  const [draftDate, setDraftDate] = useState(selectedDate)
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date())

  // Keep internal mode in sync when caller mode changes
  useEffect(() => {
    setDraftMode(mode)
  }, [mode])

  // Synchronize draft state when popover opens
  function handleOpenChange(nextOpen) {
    setIsOpen(nextOpen)
    if (nextOpen) {
      setDraftMode(mode)
      setDraftDate(selectedDate)
      setViewDate(selectedDate || new Date())
    }
  }

  const normDraftMode = normalizeMode(draftMode)
  const accessibleLabel = accessibleLabelOverride || (normDraftMode === 'month'
    ? 'Select chart month'
    : normDraftMode === 'week'
      ? 'Select chart week'
      : 'Select chart date')

  function handlePresetClick(presetId) {
    const nextMode = presetId === 'today' && mode === 'day' ? 'day' : presetId
    setDraftMode(nextMode)
    onModeChange?.(nextMode)
  }

  function handleSelect(date, selectionMode) {
    const modeToUse = selectionMode || draftMode
    if (!date) return

    const normalized = normalizeCalendarSelection(modeToUse, date)
    if (maxDate && normalized > maxDate) return

    setDraftDate(normalized)
    onDateChange(normalized)
    setIsOpen(false)
  }

  function handleApply() {
    const targetDate = draftDate || selectedDate
    if (!targetDate) {
      setIsOpen(false)
      return
    }

    const normalized = normalizeCalendarSelection(draftMode, targetDate)
    if (maxDate && normalized > maxDate) return

    onDateChange(normalized)
    setIsOpen(false)
  }

  function handleCancel() {
    setDraftMode(mode)
    setDraftDate(selectedDate)
    setIsOpen(false)
  }

  function handlePrevYear() {
    setViewDate((prev) => new Date(prev.getFullYear() - 1, prev.getMonth(), 1))
  }

  function handleNextYear() {
    setViewDate((prev) => new Date(prev.getFullYear() + 1, prev.getMonth(), 1))
  }

  function handlePrevMonth() {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  function handleNextMonth() {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  // Month navigation calculation
  const nextMonthStart = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
  const monthHeading = viewDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  const monthsOfYear = Array.from({ length: 12 }, (_, m) => new Date(viewDate.getFullYear(), m, 1))
  const monthWeeks = getMonthWeeks(viewDate)
  const monthDays = getDaysForMonth(viewDate)

  // Determine footer summary label dynamically based on active selection and current draft mode
  const activeDate = draftDate || selectedDate
  let footerSelectionLabel = ''
  if (activeDate) {
    if (normDraftMode === 'month') {
      footerSelectionLabel = activeDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
    } else if (normDraftMode === 'week') {
      const start = startOfWeek(activeDate)
      footerSelectionLabel = `${formatWeekLabel(start)} · 1 week`
    } else {
      footerSelectionLabel = activeDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  } else if (rangeLabel) {
    footerSelectionLabel = rangeLabel
  } else {
    footerSelectionLabel = 'Select period'
  }

  return (
    <div className="trend-calendar-control">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className={`trend-calendar-trigger ${isOpen ? 'is-open' : ''}`}
            type="button"
            aria-expanded={isOpen}
            aria-label={triggerAriaLabel}
            title={accessibleLabel}
          >
            <CalendarDays size={16} aria-hidden="true" />
            <span className="trend-calendar-copy">
              <span className="trend-calendar-kicker">{triggerLabel}</span>
              {' '}
              <span className="trend-calendar-value">{rangeLabel}</span>
            </span>
            <ChevronDown className="trend-calendar-chevron" size={16} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label={accessibleLabel} className={`trend-calendar-popover ${popoverClassName || ''}`.trim()}>
          <div className="trend-popover-body">
            {showPresets && (
              <div className="trend-popover-sidebar" role="group" aria-label="Quick presets">
                {presets.map((preset) => {
                  const isActive = (preset.id === draftMode) ||
                    (preset.id === 'today' && (draftMode === 'today' || draftMode === 'day')) ||
                    (preset.id === 'day' && (draftMode === 'today' || draftMode === 'day'))
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`trend-preset-btn ${isActive ? 'is-active' : ''}`}
                      aria-pressed={isActive}
                      onClick={() => handlePresetClick(preset.id)}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="trend-popover-calendar">
              {normDraftMode === 'month' ? (
                <div className="trend-month-view">
                  <div className="trend-calendar-header">
                    <button
                      type="button"
                      className="trend-calendar-nav-btn"
                      aria-label="Previous year"
                      onClick={handlePrevYear}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <strong>{viewDate.getFullYear()}</strong>
                    <button
                      type="button"
                      className="trend-calendar-nav-btn"
                      aria-label="Next year"
                      disabled={Boolean(maxDate && viewDate.getFullYear() >= maxDate.getFullYear())}
                      onClick={handleNextYear}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="trend-calendar-months-grid">
                    {monthsOfYear.map((m) => {
                      const isSelected = Boolean(activeDate &&
                        m.getFullYear() === activeDate.getFullYear() &&
                        m.getMonth() === activeDate.getMonth())
                      const isMonthDisabled = Boolean(maxDate && m > maxDate)
                      const monthLabel = m.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
                      return (
                        <button
                          key={m.getMonth()}
                          type="button"
                          className={`trend-calendar-month-btn ${isSelected ? 'is-selected' : ''}`}
                          aria-pressed={isSelected}
                          disabled={isMonthDisabled}
                          onClick={() => handleSelect(m, 'month')}
                        >
                          {monthLabel}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : normDraftMode === 'week' ? (
                <div className="trend-week-view">
                  <div className="trend-calendar-header">
                    <button
                      type="button"
                      className="trend-calendar-nav-btn"
                      aria-label="Previous month"
                      onClick={handlePrevMonth}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <strong>{monthHeading}</strong>
                    <button
                      type="button"
                      className="trend-calendar-nav-btn"
                      aria-label="Next month"
                      disabled={Boolean(maxDate && nextMonthStart > maxDate)}
                      onClick={handleNextMonth}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="trend-calendar-weekdays" aria-hidden="true">
                    {WEEKDAY_HEADERS.map((w) => (
                      <span key={w} className="trend-calendar-weekday">{w}</span>
                    ))}
                  </div>
                  <div className="trend-calendar-week-grid">
                    {monthWeeks.map((weekStart) => {
                      const isSelected = Boolean(activeDate && startOfWeek(activeDate).getTime() === weekStart.getTime())
                      const isWeekDisabled = Boolean(maxDate && weekStart > maxDate)
                      const weekLabel = formatWeekLabel(weekStart)
                      const daysInWeek = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
                      return (
                        <button
                          key={weekStart.toISOString()}
                          type="button"
                          className={`trend-calendar-week-row ${isSelected ? 'is-selected' : ''}`}
                          aria-label={`Select week ${weekLabel}`}
                          aria-pressed={isSelected}
                          disabled={isWeekDisabled}
                          onClick={() => handleSelect(weekStart, 'week')}
                        >
                          <div className="trend-calendar-week-days" aria-hidden="true">
                            {daysInWeek.map((day) => (
                              <span
                                key={day.toISOString()}
                                className={`trend-calendar-week-day-cell ${day.getMonth() !== viewDate.getMonth() ? 'is-outside' : ''}`}
                              >
                                {day.getDate()}
                              </span>
                            ))}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="trend-day-view">
                  <div className="trend-calendar-header">
                    <button
                      type="button"
                      className="trend-calendar-nav-btn"
                      aria-label="Previous month"
                      onClick={handlePrevMonth}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <strong>{monthHeading}</strong>
                    <button
                      type="button"
                      className="trend-calendar-nav-btn"
                      aria-label="Next month"
                      disabled={Boolean(maxDate && nextMonthStart > maxDate)}
                      onClick={handleNextMonth}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="trend-calendar-weekdays" aria-hidden="true">
                    {WEEKDAY_HEADERS.map((w) => (
                      <span key={w} className="trend-calendar-weekday">{w}</span>
                    ))}
                  </div>
                  <div className="trend-calendar-day-grid" role="grid">
                    {monthDays.map((day) => {
                      const isSelected = Boolean(activeDate && isSameDay(day, activeDate))
                      const isDisabled = Boolean(maxDate && day > maxDate)
                      const isOutside = day.getMonth() !== viewDate.getMonth()
                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          className={`trend-calendar-day-btn ${isSelected ? 'is-selected' : ''} ${isOutside ? 'is-outside' : ''}`}
                          aria-label={getDayAriaLabel(day)}
                          aria-pressed={isSelected}
                          disabled={isDisabled}
                          onClick={() => handleSelect(day, 'day')}
                        >
                          {day.getDate()}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="trend-popover-footer">
            <span className="trend-popover-footer-text">
              {footerSelectionLabel}
            </span>
            <div className="trend-popover-footer-actions">
              <button
                type="button"
                className="trend-popover-cancel-btn"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="trend-popover-apply-btn"
                onClick={handleApply}
              >
                Apply
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
