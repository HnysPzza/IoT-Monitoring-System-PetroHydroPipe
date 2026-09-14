import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import { Calendar } from '../../../shared/components/ui/Calendar.jsx'
import '../../../shared/components/ui/calendar.css'
import './analytics-date-range-picker.css'

function parseDateInput(value) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function formatDateInput(date) {
  if (!date) return ''
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function formatDateLabel(value) {
  return parseDateInput(value)?.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) || ''
}

function toRange(startDate, endDate) {
  return { from: parseDateInput(startDate), to: parseDateInput(endDate) }
}

export default function AnalyticsDateRangePicker({ startDate, endDate, maxDate, onChange, isActive = false }) {
  const [isOpen, setIsOpen] = useState(false)
  const value = useMemo(() => toRange(startDate, endDate), [endDate, startDate])
  const [draftRange, setDraftRange] = useState(value)

  useEffect(() => {
    if (!isOpen) setDraftRange(value)
  }, [isOpen, value])

  function handleOpenChange(nextOpen) {
    setIsOpen(nextOpen)
    if (nextOpen) {
      setDraftRange(value)
    }
  }

  function handleSelect(nextRange) {
    setDraftRange(nextRange || {})
    if (!nextRange?.from || !nextRange?.to) return

    onChange?.({
      startDate: formatDateInput(nextRange.from),
      endDate: formatDateInput(nextRange.to),
    })
    setIsOpen(false)
  }

  const dateLabel = startDate && endDate
    ? `${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`
    : 'Choose dates'

  return (
    <div className="analytics-date-range-picker">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className={`analytics-custom-trigger ${isActive ? 'is-selected' : ''}`}
            type="button"
            aria-label="Custom date range"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
          >
            <CalendarDays size={16} aria-hidden="true" />
            <span className="analytics-custom-copy">
              <span className="analytics-custom-kicker">Custom</span>
              <span className="analytics-custom-value">{dateLabel}</span>
            </span>
            <ChevronDown className="analytics-custom-chevron" size={15} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="analytics-date-range-popover" aria-label="Custom date range">
          <Calendar
            className="analytics-date-range-calendar"
            mode="range"
            selected={draftRange}
            defaultMonth={draftRange.from || parseDateInput(maxDate)}
            disabled={maxDate ? { after: parseDateInput(maxDate) } : undefined}
            onSelect={handleSelect}
            weekStartsOn={1}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
