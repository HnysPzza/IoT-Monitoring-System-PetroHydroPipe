import { useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { Calendar } from '../../../shared/components/ui/Calendar.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import '../../../shared/components/ui/calendar.css'

export function normalizeCalendarSelection(mode, date) {
  if (mode === 'month') {
    return new Date(date.getFullYear(), date.getMonth(), 1)
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export default function TrendCalendarControl({ mode, selectedDate, maxDate, rangeLabel, onDateChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const accessibleLabel = mode === 'month' ? 'Select chart month' : 'Select chart date'

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
            aria-label={accessibleLabel}
            aria-expanded={isOpen}
          >
            <CalendarDays size={18} aria-hidden="true" />
            <span className="trend-calendar-copy">
              <span className="trend-calendar-kicker">Selected period</span>
              <span className="trend-calendar-value">{rangeLabel}</span>
            </span>
            <ChevronDown className="trend-calendar-chevron" size={16} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label={accessibleLabel}>
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={handleSelect}
            disabled={{ after: maxDate }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
