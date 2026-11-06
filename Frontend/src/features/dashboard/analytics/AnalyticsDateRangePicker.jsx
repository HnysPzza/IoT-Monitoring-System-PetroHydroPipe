import { useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import '../../../shared/components/ui/calendar.css'
import './analytics-date-range-picker.css'

export function getMondayToSundaySpan(selectedDate) {
  const d = new Date(selectedDate)
  const day = d.getDay() // 0 is Sunday, 1 is Monday ... 6 is Saturday

  // Calculate difference to Monday: if Sunday (0), Monday is -6 days; otherwise 1 - day
  const diffToMonday = day === 0 ? -6 : 1 - day

  const monday = new Date(d)
  monday.setDate(d.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)

  return { start: monday, end: sunday }
}

export function getMonthSpan(date) {
  const d = new Date(date)
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

export function parseDateInput(value) {
  if (!value) return null
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12)
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day, 12)
}

export function formatDateInput(date) {
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateRange(startDate, endDate) {
  if (!startDate) return ''
  if (!endDate) {
    return startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' })
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' })
  const startYear = startDate.getFullYear()
  const endYear = endDate.getFullYear()

  if (startYear === endYear) {
    return `${startMonth} ${startDate.getDate()} \u2013 ${endMonth} ${endDate.getDate()}, ${startYear}`
  }
  return `${startMonth} ${startDate.getDate()}, ${startYear} \u2013 ${endMonth} ${endDate.getDate()}, ${endYear}`
}

export function isSameDay(d1, d2) {
  if (!d1 || !d2) return false
  return (
    d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate()
  )
}

export function isDateInRange(date, start, end) {
  if (!date || !start || !end) return false
  const t = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  return t >= s && t <= e
}

export const PRESETS = [
  { id: 'week', label: 'Weekly', eyebrow: 'WEEKLY' },
  { id: 'month', label: 'Monthly', eyebrow: 'MONTHLY' },
  { id: 'all', label: 'All time', eyebrow: 'ALL TIME' },
  { id: 'custom', label: 'Custom Range', eyebrow: 'CUSTOM RANGE' },
]

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function getDurationText(start, end, preset) {
  if (preset === 'all') return 'All Time'
  if (!start || !end) return ''
  if (preset === 'month') return '1 month'

  const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  const days = Math.round((endTime - startTime) / 86400000) + 1

  if (days === 7) return '1 week'
  if (days % 7 === 0) return `${days / 7} weeks`
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

function getFooterText(preset, start, end) {
  if (preset === 'all') return 'All Time'
  if (!start && !end) return 'Select date range'
  if (start && !end) return 'Select end date'
  const rangeStr = formatDateRange(start, end)
  const duration = getDurationText(start, end, preset)
  return `${rangeStr} \u00b7 ${duration}`
}

function getTriggerValueText(period, startDate, endDate) {
  if (period === 'all') return 'All Time'
  const start = parseDateInput(startDate)
  if (!start) return 'Choose a period'
  if (period === 'month') {
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  const end = parseDateInput(endDate) || start
  return formatDateRange(start, end)
}

function getCalendarWeeksForMonth(viewDate) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstOfMonth = new Date(year, month, 1, 12)
  const lastOfMonth = new Date(year, month + 1, 0, 12)

  const firstMonday = getMondayToSundaySpan(firstOfMonth).start
  const lastSunday = getMondayToSundaySpan(lastOfMonth).end

  const weeks = []
  const current = new Date(firstMonday)
  current.setHours(12, 0, 0, 0)

  while (current <= lastSunday) {
    const week = []
    for (let i = 0; i < 7; i++) {
      const day = new Date(current)
      day.setDate(current.getDate() + i)
      day.setHours(12, 0, 0, 0)
      week.push(day)
    }
    weeks.push(week)
    current.setDate(current.getDate() + 7)
  }

  return weeks
}

export default function AnalyticsDateRangePicker({
  period = 'week',
  startDate,
  endDate,
  maxDate,
  onChange,
}) {
  const maxDateValue = parseDateInput(maxDate)
  const [isOpen, setIsOpen] = useState(false)
  const [pendingPreset, setPendingPreset] = useState(period || 'week')
  const [pendingRange, setPendingRange] = useState(() => {
    if (period === 'all') return { start: null, end: null }
    if (period === 'month') {
      const d = parseDateInput(startDate) || new Date()
      return getMonthSpan(d)
    }
    if (period === 'custom' && startDate && endDate) {
      return { start: parseDateInput(startDate), end: parseDateInput(endDate) }
    }
    const d = parseDateInput(startDate) || new Date()
    return getMondayToSundaySpan(d)
  })
  const [viewDate, setViewDate] = useState(() => parseDateInput(startDate) || new Date())
  const [hoveredDay, setHoveredDay] = useState(null)
  const [isCustomSelecting, setIsCustomSelecting] = useState(false)

  function handleOpenChange(nextOpen) {
    setIsOpen(nextOpen)
    if (nextOpen) {
      setPendingPreset(period || 'week')
      let initialRange
      if (period === 'all') {
        initialRange = { start: null, end: null }
      } else if (period === 'month') {
        const d = parseDateInput(startDate) || new Date()
        initialRange = getMonthSpan(d)
      } else if (period === 'custom' && startDate && endDate) {
        initialRange = { start: parseDateInput(startDate), end: parseDateInput(endDate) }
      } else {
        const d = parseDateInput(startDate) || new Date()
        initialRange = getMondayToSundaySpan(d)
      }
      setPendingRange(initialRange)
      setViewDate(initialRange.start || parseDateInput(startDate) || new Date())
      setHoveredDay(null)
      setIsCustomSelecting(false)
    }
  }

  function handlePresetClick(presetId) {
    setPendingPreset(presetId)
    setIsCustomSelecting(false)
    setHoveredDay(null)

    if (presetId === 'all') {
      setPendingRange({ start: null, end: null })
    } else if (presetId === 'month') {
      const span = getMonthSpan(viewDate)
      setPendingRange(span)
    } else if (presetId === 'week') {
      const baseDate = pendingRange.start || viewDate
      const span = getMondayToSundaySpan(baseDate)
      setPendingRange(span)
    } else if (presetId === 'custom') {
      if (!pendingRange.start || !pendingRange.end) {
        setPendingRange({ start: null, end: null })
      }
    }
  }

  function handleDayClick(day) {
    if (pendingPreset === 'all' || (maxDateValue && !isCustomSelecting && day > maxDateValue)) return

    if (pendingPreset === 'week') {
      const span = getMondayToSundaySpan(day)
      setPendingRange(span)
      return
    }

    if (pendingPreset === 'month') {
      const targetMonth = new Date(day.getFullYear(), day.getMonth(), 1, 12)
      setViewDate(targetMonth)
      setPendingRange(getMonthSpan(targetMonth))
      return
    }

    if (pendingPreset === 'custom') {
      if (!isCustomSelecting || !pendingRange.start) {
        setPendingRange({ start: day, end: null })
        setIsCustomSelecting(true)
      } else {
        let start = pendingRange.start
        let end = day
        if (end < start) {
          start = day
          end = pendingRange.start
        }
        setPendingRange({ start, end })
        setIsCustomSelecting(false)
        setHoveredDay(null)
      }
    }
  }

  function handleDayHover(day) {
    if (pendingPreset === 'all') return
    setHoveredDay(day)
  }

  function handleGridMouseLeave() {
    setHoveredDay(null)
  }

  function handleYearChange(amount) {
    setViewDate((prev) => new Date(prev.getFullYear() + amount, prev.getMonth(), 1, 12))
  }

  function handlePrevMonth() {
    setViewDate((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() - 1, 1, 12)
      if (pendingPreset === 'month') {
        setPendingRange(getMonthSpan(next))
      }
      return next
    })
  }

  function handleNextMonth() {
    setViewDate((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + 1, 1, 12)
      if (pendingPreset === 'month') {
        setPendingRange(getMonthSpan(next))
      }
      return next
    })
  }

  function handleCancel() {
    setIsOpen(false)
  }

  function handleApply() {
    if (maxDateValue && pendingPreset !== 'all' && pendingRange.start > maxDateValue) return
    setIsOpen(false)
    if (pendingPreset === 'all') {
      onChange?.({ period: 'all' })
    } else if (pendingPreset === 'month') {
      onChange?.({
        period: 'month',
        startDate: formatDateInput(pendingRange.start),
        endDate: formatDateInput(pendingRange.end),
      })
    } else if (pendingPreset === 'custom') {
      onChange?.({
        period: 'custom',
        startDate: formatDateInput(pendingRange.start),
        endDate: formatDateInput(pendingRange.end),
      })
    } else {
      onChange?.({
        period: 'week',
        startDate: formatDateInput(pendingRange.start),
        endDate: formatDateInput(pendingRange.end),
      })
    }
  }

  const activeSpan = useMemo(() => {
    if (pendingPreset === 'all') {
      return { start: null, end: null }
    }
    if (pendingPreset === 'week') {
      if (hoveredDay) {
        return getMondayToSundaySpan(hoveredDay)
      }
      return pendingRange
    }
    if (pendingPreset === 'month') {
      return pendingRange
    }
    if (pendingPreset === 'custom') {
      if (isCustomSelecting && pendingRange.start && hoveredDay) {
        const start = pendingRange.start < hoveredDay ? pendingRange.start : hoveredDay
        const end = pendingRange.start < hoveredDay ? hoveredDay : pendingRange.start
        return { start, end }
      }
      return pendingRange
    }
    return { start: null, end: null }
  }, [hoveredDay, isCustomSelecting, pendingPreset, pendingRange])

  const weeks = useMemo(() => getCalendarWeeksForMonth(viewDate), [viewDate])
  const currentPresetConfig = PRESETS.find((p) => p.id === period) || PRESETS[0]
  const triggerEyebrow = currentPresetConfig.eyebrow
  const triggerValue = getTriggerValueText(period, startDate, endDate)
  const isApplyDisabled = pendingPreset === 'custom' && (!pendingRange.start || !pendingRange.end)

  return (
    <div className="analytics-date-range-picker">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`analytics-date-trigger ${isOpen ? 'is-open' : ''}`}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            aria-label="Select Analytics date range"
            title="Select Analytics date range"
          >
            <CalendarDays size={16} className="analytics-date-trigger-icon" aria-hidden="true" />
            <span className="analytics-date-trigger-copy">
              <span className="analytics-date-trigger-eyebrow">{triggerEyebrow}</span>
              <span className="analytics-date-trigger-value">{triggerValue}</span>
            </span>
            <ChevronDown size={16} className="analytics-date-trigger-chevron" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="analytics-date-range-popover"
          align="end"
          sideOffset={6}
          aria-label="Select Analytics date range"
        >
          <div className="analytics-popover-body">
            <div className="analytics-popover-sidebar" role="group" aria-label="Quick presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`analytics-preset-btn ${pendingPreset === preset.id ? 'is-active' : ''}`}
                  aria-pressed={pendingPreset === preset.id}
                  onClick={() => handlePresetClick(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="analytics-popover-calendar">
              <div className="analytics-calendar-header">
                <button
                  type="button"
                  className="analytics-calendar-nav-btn"
                  aria-label={pendingPreset === 'month' ? 'Previous year' : 'Previous month'}
                  disabled={pendingPreset === 'all'}
                  onClick={pendingPreset === 'month' ? () => handleYearChange(-1) : handlePrevMonth}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="analytics-calendar-month-title">
                  {pendingPreset === 'month' ? viewDate.getFullYear() : viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  className="analytics-calendar-nav-btn"
                  aria-label={pendingPreset === 'month' ? 'Next year' : 'Next month'}
                  disabled={pendingPreset === 'all' || Boolean(maxDateValue && (pendingPreset === 'month' ? viewDate.getFullYear() >= maxDateValue.getFullYear() : new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1, 12) > maxDateValue))}
                  onClick={pendingPreset === 'month' ? () => handleYearChange(1) : handleNextMonth}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>

              {pendingPreset === 'month' ? (
                <div className="trend-calendar-months-grid">
                  {Array.from({ length: 12 }, (_, month) => {
                    const date = new Date(viewDate.getFullYear(), month, 1, 12)
                    const selected = pendingRange.start && date.getFullYear() === pendingRange.start.getFullYear() && month === pendingRange.start.getMonth()
                    const future = Boolean(maxDateValue && date > maxDateValue)
                    return (
                      <button key={month} type="button" className={`trend-calendar-month-btn ${selected ? 'is-selected' : ''} ${future ? 'is-future' : ''}`}
                        aria-label={date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} aria-pressed={Boolean(selected)} disabled={future}
                        onClick={() => { setViewDate(date); setPendingRange(getMonthSpan(date)) }}>
                        {date.toLocaleDateString('en-US', { month: 'short' })}
                      </button>
                    )
                  })}
                </div>
              ) : (<>
              <div className="analytics-calendar-weekdays" aria-hidden="true">
                {WEEKDAYS.map((wd) => (
                  <span key={wd} className="analytics-calendar-weekday">{wd}</span>
                ))}
              </div>

              <div
                className={`analytics-calendar-grid ${pendingPreset === 'all' ? 'is-all-time' : ''}`}
                onMouseLeave={handleGridMouseLeave}
              >
                {weeks.map((week, wIndex) => (
                  <div key={wIndex} className="analytics-calendar-week-row">
                    {week.map((day) => {
                      const isOutside = day.getMonth() !== viewDate.getMonth()
                      const isStart = Boolean(activeSpan.start && isSameDay(day, activeSpan.start))
                      const isEnd = Boolean(activeSpan.end && isSameDay(day, activeSpan.end))
                      const isMid = Boolean(isDateInRange(day, activeSpan.start, activeSpan.end) && !isStart && !isEnd)
                      const isSingle = isStart && isEnd

                      let cellClass = ''
                      if (isSingle) {
                        cellClass = 'is-start is-end'
                      } else if (isStart) {
                        cellClass = 'is-start'
                      } else if (isEnd) {
                        cellClass = 'is-end'
                      } else if (isMid) {
                        cellClass = 'is-mid'
                      } else if (isOutside) {
                        cellClass = 'is-outside'
                      }

                      const dayLabel = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          className={`analytics-calendar-day-btn ${cellClass} ${maxDateValue && day > maxDateValue ? 'is-future' : ''}`.trim()}
                          disabled={pendingPreset === 'all' || Boolean(maxDateValue && !isCustomSelecting && day > maxDateValue)}
                          aria-label={`Select date ${dayLabel}`}
                          onClick={() => handleDayClick(day)}
                          onMouseEnter={() => handleDayHover(day)}
                        >
                          {day.getDate()}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
              </>)}
            </div>
          </div>

          <div className="analytics-popover-footer">
            <span className="analytics-popover-footer-text">
              {getFooterText(pendingPreset, pendingRange.start, pendingRange.end)}
            </span>
            <div className="analytics-popover-footer-actions">
              <button
                type="button"
                className="analytics-popover-cancel-btn"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="analytics-popover-apply-btn"
                disabled={isApplyDisabled}
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
