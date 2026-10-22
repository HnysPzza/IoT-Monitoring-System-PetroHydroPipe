import TrendCalendarControl from '../overview/TrendCalendarControl.jsx'
import './analytics-date-range-picker.css'

function parseDateInput(value) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function formatDateInput(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function getRangeLabel(period, selectedDate) {
  const date = parseDateInput(selectedDate)
  if (!date) return 'Choose a period'

  if (period === 'month') {
    return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  }

  const monday = new Date(date)
  monday.setDate(monday.getDate() - (monday.getDay() || 7) + 1)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(monday, sunday)
}

export default function AnalyticsDateRangePicker({ period, selectedDate, maxDate, onChange, isActive = false }) {
  const mode = period === 'month' ? 'month' : 'week'
  const modeLabel = mode === 'month' ? 'Monthly' : 'Weekly'
  const accessibleLabel = `Select Analytics ${mode}`

  return (
    <div className={`analytics-date-range-picker ${isActive ? 'is-selected' : ''}`}>
      <TrendCalendarControl
        mode={mode}
        selectedDate={parseDateInput(selectedDate)}
        maxDate={parseDateInput(maxDate)}
        rangeLabel={getRangeLabel(period, selectedDate)}
        onDateChange={(date) => onChange?.(formatDateInput(date))}
        accessibleLabel={accessibleLabel}
        triggerAriaLabel={accessibleLabel}
        triggerLabel={modeLabel}
        popoverClassName="analytics-date-range-popover"
      />
    </div>
  )
}
