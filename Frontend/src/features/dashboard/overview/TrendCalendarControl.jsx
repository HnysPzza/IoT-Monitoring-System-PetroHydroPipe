import { lazy, Suspense, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import '../../../shared/components/ui/calendar.css'

const Calendar = lazy(() => import('../../../shared/components/ui/Calendar.jsx').then((module) => ({ default: module.Calendar })))

export function normalizeCalendarSelection(mode, date) {
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

function MonthPicker({ selectedDate, maxDate, onSelect }) {
  const [year, setYear] = useState(selectedDate.getFullYear())
  const months = Array.from({ length: 12 }, (_, month) => new Date(year, month, 1))

  return (
    <div className="trend-month-picker">
      <div className="trend-month-picker-heading">
        <button type="button" aria-label="Previous year" onClick={() => setYear((current) => current - 1)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <strong>{year}</strong>
        <button
          type="button"
          aria-label="Next year"
          disabled={year >= maxDate.getFullYear()}
          onClick={() => setYear((current) => current + 1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="trend-month-grid">
        {months.map((month) => {
          const isSelected = month.getFullYear() === selectedDate.getFullYear()
            && month.getMonth() === selectedDate.getMonth()

          return (
            <button
              key={month.getMonth()}
              className={isSelected ? 'is-selected' : ''}
              type="button"
              aria-pressed={isSelected}
              disabled={month > maxDate}
              onClick={() => onSelect(month)}
            >
              {month.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeekPicker({ selectedDate, maxDate, onSelect }) {
  const [viewDate, setViewDate] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
  const weeks = getMonthWeeks(viewDate)
  const selectedWeekStart = startOfWeek(selectedDate)
  const nextMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
  const monthLabel = viewDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })

  return (
    <div className="trend-week-picker">
      <div className="trend-week-picker-heading">
        <button type="button" aria-label="Previous month" onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <strong>{monthLabel}</strong>
        <button
          type="button"
          aria-label="Next month"
          disabled={nextMonth > maxDate}
          onClick={() => setViewDate(nextMonth)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="trend-week-grid">
        {weeks.map((week) => {
          const isSelected = week.getTime() === selectedWeekStart.getTime()
          const weekLabel = formatWeekLabel(week)

          return (
            <button
              key={week.toISOString()}
              type="button"
              className={isSelected ? 'is-selected' : ''}
              aria-label={`Select week ${weekLabel}`}
              aria-pressed={isSelected}
              disabled={week > maxDate}
              onClick={() => onSelect(week)}
            >
              {weekLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function TrendCalendarControl({ mode, selectedDate, maxDate, rangeLabel, onDateChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const accessibleLabel = mode === 'month'
    ? 'Select chart month'
    : mode === 'week'
      ? 'Select chart week'
      : 'Select chart date'

  function handleSelect(date) {
    if (!date || date > maxDate) return

    onDateChange(normalizeCalendarSelection(mode, date))
    setIsOpen(false)
  }

  return (
    <div className="trend-calendar-control">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            className="trend-calendar-trigger"
            type="button"
            aria-expanded={isOpen}
            title={accessibleLabel}
          >
            <CalendarDays size={18} aria-hidden="true" />
            <span className="trend-calendar-copy">
              <span className="trend-calendar-kicker">SELECTED PERIOD</span>
              {' '}
              <span className="trend-calendar-value">{rangeLabel}</span>
            </span>
            <ChevronDown className="trend-calendar-chevron" size={16} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label={accessibleLabel}>
          {mode === 'month' ? (
            <MonthPicker selectedDate={selectedDate} maxDate={maxDate} onSelect={handleSelect} />
          ) : mode === 'week' ? (
            <WeekPicker selectedDate={selectedDate} maxDate={maxDate} onSelect={handleSelect} />
          ) : (
            <Suspense fallback={<div className="shadcn-calendar-loading" role="status">Loading calendar</div>}>
              <Calendar
                mode="single"
                selected={selectedDate}
                defaultMonth={selectedDate}
                onSelect={handleSelect}
                disabled={{ after: maxDate }}
                autoFocus
              />
            </Suspense>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
