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

  const selectedWeekStart = normalizeCalendarSelection('week', selectedDate)
  const selectedWeekEnd = new Date(selectedWeekStart)
  selectedWeekEnd.setDate(selectedWeekEnd.getDate() + 6)

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
          ) : (
            <Suspense fallback={<div className="shadcn-calendar-loading" role="status">Loading calendar</div>}>
              <Calendar
                mode={mode === 'week' ? undefined : 'single'}
                selected={mode === 'week' ? undefined : selectedDate}
                defaultMonth={selectedDate}
                modifiers={mode === 'week' ? { selected: { from: selectedWeekStart, to: selectedWeekEnd } } : undefined}
                modifiersClassNames={mode === 'week' ? { selected: 'is-selected-week' } : undefined}
                onSelect={mode === 'week' ? undefined : handleSelect}
                onDayClick={mode === 'week' ? (date, modifiers) => !modifiers.disabled && handleSelect(date) : undefined}
                disabled={{ after: maxDate }}
                weekStartsOn={1}
                autoFocus
              />
            </Suspense>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
