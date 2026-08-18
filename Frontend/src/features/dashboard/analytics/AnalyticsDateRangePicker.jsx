import { useMemo, useRef } from 'react'
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DateRangePicker,
  DateSegment,
  Dialog,
  FieldError,
  Group,
  Heading,
  Label,
  Popover,
  RangeCalendar,
} from 'react-aria-components'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { parseDate } from '@internationalized/date'

function parseRangeValue(startDate, endDate) {
  if (!startDate && !endDate) return null
  if (!startDate || !endDate) return null

  try {
    const start = parseDate(startDate)
    const end = parseDate(endDate)

    return start.compare(end) <= 0 ? { start, end } : null
  } catch {
    return null
  }
}

export default function AnalyticsDateRangePicker({ startDate, endDate, onChange }) {
  const triggerRef = useRef(null)
  const value = useMemo(
    () => parseRangeValue(startDate, endDate),
    [endDate, startDate],
  )
  const hasInvalidRange = Boolean(startDate || endDate) && !value

  const handleChange = (nextRange) => {
    if (!nextRange?.start || !nextRange?.end) return

    const nextStartDate = nextRange.start.toString()
    const nextEndDate = nextRange.end.toString()

    if (nextStartDate > nextEndDate) return

    onChange({ startDate: nextStartDate, endDate: nextEndDate })
  }

  const handleOpenChange = (isOpen) => {
    if (!isOpen) queueMicrotask(() => triggerRef.current?.focus())
  }

  return (
    <DateRangePicker
      className="analytics-date-range-picker"
      value={value}
      isInvalid={hasInvalidRange}
      onChange={handleChange}
      onOpenChange={handleOpenChange}
    >
      <Label className="analytics-date-range-picker-label">Custom date range</Label>
      <Group className="analytics-date-range-picker-group">
        <DateInput slot="start" className="analytics-date-range-picker-input" aria-label="Start date">
          {(segment) => <DateSegment segment={segment} />}
        </DateInput>
        <span className="analytics-date-range-picker-separator" aria-hidden="true">to</span>
        <DateInput slot="end" className="analytics-date-range-picker-input" aria-label="End date">
          {(segment) => <DateSegment segment={segment} />}
        </DateInput>
        <Button
          className="analytics-date-range-picker-trigger"
          aria-label="Open custom date range calendar"
          aria-labelledby={null}
          ref={triggerRef}
        >
          <CalendarDays size={18} aria-hidden="true" />
        </Button>
      </Group>
      <FieldError className="analytics-date-range-picker-error">
        Choose a complete valid date range.
      </FieldError>

      <Popover className="analytics-date-range-picker-popover" placement="bottom start">
        <Dialog className="analytics-date-range-picker-dialog">
          <RangeCalendar className="analytics-date-range-picker-calendar">
            <header className="analytics-date-range-picker-calendar-header">
              <Button slot="previous" className="analytics-date-range-picker-nav-button" aria-label="Previous month">
                <ChevronLeft size={18} aria-hidden="true" />
              </Button>
              <Heading className="analytics-date-range-picker-heading" />
              <Button slot="next" className="analytics-date-range-picker-nav-button" aria-label="Next month">
                <ChevronRight size={18} aria-hidden="true" />
              </Button>
            </header>
            <CalendarGrid className="analytics-date-range-picker-grid">
              <CalendarGridHeader>
                {(day) => <CalendarHeaderCell className="analytics-date-range-picker-weekday">{day}</CalendarHeaderCell>}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => <CalendarCell className="analytics-date-range-picker-cell" date={date} />}
              </CalendarGridBody>
            </CalendarGrid>
          </RangeCalendar>
        </Dialog>
      </Popover>
    </DateRangePicker>
  )
}
