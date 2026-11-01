import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AnalyticsDateRangePicker, {
  formatDateInput,
  formatDateRange,
  getMondayToSundaySpan,
  getMonthSpan,
} from './AnalyticsDateRangePicker.jsx'

describe('AnalyticsDateRangePicker helpers', () => {
  it('computes exact Monday-to-Sunday span for any day of the week', () => {
    // Saturday Oct 31, 2026
    const saturday = new Date(2026, 9, 31, 12)
    const satSpan = getMondayToSundaySpan(saturday)
    expect(formatDateInput(satSpan.start)).toBe('2026-10-26')
    expect(formatDateInput(satSpan.end)).toBe('2026-11-01')

    // Sunday Nov 1, 2026
    const sunday = new Date(2026, 10, 1, 12)
    const sunSpan = getMondayToSundaySpan(sunday)
    expect(formatDateInput(sunSpan.start)).toBe('2026-10-26')
    expect(formatDateInput(sunSpan.end)).toBe('2026-11-01')

    // Monday Oct 26, 2026
    const monday = new Date(2026, 9, 26, 12)
    const monSpan = getMondayToSundaySpan(monday)
    expect(formatDateInput(monSpan.start)).toBe('2026-10-26')
    expect(formatDateInput(monSpan.end)).toBe('2026-11-01')

    // Wednesday Oct 28, 2026
    const wednesday = new Date(2026, 9, 28, 12)
    const wedSpan = getMondayToSundaySpan(wednesday)
    expect(formatDateInput(wedSpan.start)).toBe('2026-10-26')
    expect(formatDateInput(wedSpan.end)).toBe('2026-11-01')
  })

  it('computes exact 1st through last day for a month span', () => {
    const novDate = new Date(2026, 10, 15, 12)
    const novSpan = getMonthSpan(novDate)
    expect(formatDateInput(novSpan.start)).toBe('2026-11-01')
    expect(formatDateInput(novSpan.end)).toBe('2026-11-30')
  })

  it('formats date ranges correctly with en-dash', () => {
    const oct26 = new Date(2026, 9, 26, 12)
    const nov1 = new Date(2026, 10, 1, 12)
    expect(formatDateRange(oct26, nov1)).toBe('Oct 26 \u2013 Nov 1, 2026')

    const nov2 = new Date(2026, 10, 2, 12)
    const nov22 = new Date(2026, 10, 22, 12)
    expect(formatDateRange(nov2, nov22)).toBe('Nov 2 \u2013 Nov 22, 2026')
  })
})

describe('AnalyticsDateRangePicker component', () => {
  it('renders trigger with dynamic eyebrow and formatted value', () => {
    render(
      <AnalyticsDateRangePicker
        period="week"
        startDate="2026-10-26"
        endDate="2026-11-01"
      />,
    )

    const trigger = screen.getByRole('button', { name: /Select Analytics date range/i })
    expect(trigger).toBeInTheDocument()
    expect(screen.getByText('WEEKLY')).toBeInTheDocument()
    expect(screen.getByText('Oct 26 \u2013 Nov 1, 2026')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('renders monthly eyebrow and full month name when period is month', () => {
    render(
      <AnalyticsDateRangePicker
        period="month"
        startDate="2026-11-01"
        endDate="2026-11-30"
      />,
    )

    expect(screen.getByText('MONTHLY')).toBeInTheDocument()
    expect(screen.getByText('November 2026')).toBeInTheDocument()
  })

  it('renders ALL TIME eyebrow and All Time value when period is all', () => {
    render(
      <AnalyticsDateRangePicker
        period="all"
      />,
    )

    expect(screen.getByText('ALL TIME')).toBeInTheDocument()
    expect(screen.getByText('All Time')).toBeInTheDocument()
  })

  it('renders CUSTOM RANGE eyebrow and custom range text when period is custom', () => {
    render(
      <AnalyticsDateRangePicker
        period="custom"
        startDate="2026-11-02"
        endDate="2026-11-22"
      />,
    )

    expect(screen.getByText('CUSTOM RANGE')).toBeInTheDocument()
    expect(screen.getByText('Nov 2 \u2013 Nov 22, 2026')).toBeInTheDocument()
  })

  it('opens popover showing 4 presets and calendar grid with Monday-first headers', async () => {
    const user = userEvent.setup()
    render(
      <AnalyticsDateRangePicker
        period="week"
        startDate="2026-10-26"
        endDate="2026-11-01"
      />,
    )

    const trigger = screen.getByRole('button', { name: /Select Analytics date range/i })
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveClass('is-open')
    expect(screen.getByRole('dialog', { name: 'Select Analytics date range' })).toBeInTheDocument()

    // 4 quick presets
    expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monthly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All time' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom Range' })).toBeInTheDocument()

    // Weekly is active by default
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveClass('is-active')

    // Weekday headers: Mo, Tu, We, Th, Fr, Sa, Su
    expect(screen.getByText('Mo')).toBeInTheDocument()
    expect(screen.getByText('Tu')).toBeInTheDocument()
    expect(screen.getByText('We')).toBeInTheDocument()
    expect(screen.getByText('Th')).toBeInTheDocument()
    expect(screen.getByText('Fr')).toBeInTheDocument()
    expect(screen.getByText('Sa')).toBeInTheDocument()
    expect(screen.getByText('Su')).toBeInTheDocument()

    // Footer bar
    expect(screen.getByText(/Oct 26 \u2013 Nov 1, 2026 \u00b7 1 week/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })

  it('in Weekly mode, clicking any day in a week row selects the full Monday-through-Sunday span', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <AnalyticsDateRangePicker
        period="week"
        startDate="2026-10-26"
        endDate="2026-11-01"
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Select Analytics date range/i }))

    // Click Saturday, Oct 31, 2026
    const satBtn = screen.getByRole('button', { name: 'Select date Oct 31, 2026' })
    await user.click(satBtn)

    // Footer shows Oct 26 – Nov 1, 2026 · 1 week
    expect(screen.getByText(/Oct 26 \u2013 Nov 1, 2026 \u00b7 1 week/)).toBeInTheDocument()

    // Monday cell has .is-start
    const monBtn = screen.getByRole('button', { name: 'Select date Oct 26, 2026' })
    expect(monBtn).toHaveClass('is-start')

    // Mid cell has .is-mid
    expect(satBtn).toHaveClass('is-mid')

    // Sunday cell has .is-end
    const sunBtn = screen.getByRole('button', { name: 'Select date Nov 1, 2026' })
    expect(sunBtn).toHaveClass('is-end')

    // Click Apply
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(handleChange).toHaveBeenCalledWith({
      period: 'week',
      startDate: '2026-10-26',
      endDate: '2026-11-01',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('in Monthly mode, highlights 1st through last day as solid continuous block', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <AnalyticsDateRangePicker
        period="week"
        startDate="2026-10-26"
        endDate="2026-11-01"
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Select Analytics date range/i }))
    await user.click(screen.getByRole('button', { name: 'Monthly' }))

    // Day 1 (Oct 1) is start, Day 31 (Oct 31) is end
    const day1Btn = screen.getByRole('button', { name: 'Select date Oct 1, 2026' })
    const day31Btn = screen.getByRole('button', { name: 'Select date Oct 31, 2026' })
    expect(day1Btn).toHaveClass('is-start')
    expect(day31Btn).toHaveClass('is-end')

    expect(screen.getByText(/Oct 1 \u2013 Oct 31, 2026 \u00b7 1 month/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(handleChange).toHaveBeenCalledWith({
      period: 'month',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    })
  })

  it('in All time mode, dims the calendar grid and selects full history', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <AnalyticsDateRangePicker
        period="week"
        startDate="2026-10-26"
        endDate="2026-11-01"
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Select Analytics date range/i }))
    await user.click(screen.getByRole('button', { name: 'All time' }))

    const grid = document.querySelector('.analytics-calendar-grid')
    expect(grid).toHaveClass('is-all-time')
    expect(screen.getByText('All Time')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(handleChange).toHaveBeenCalledWith({
      period: 'all',
    })
  })

  it('in Custom Range mode, allows multi-week span selection with first and second click', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <AnalyticsDateRangePicker
        period="week"
        startDate="2026-10-26"
        endDate="2026-11-01"
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Select Analytics date range/i }))
    await user.click(screen.getByRole('button', { name: 'Custom Range' }))

    // First click: Oct 5, 2026
    const startBtn = screen.getByRole('button', { name: 'Select date Oct 5, 2026' })
    await user.click(startBtn)
    expect(startBtn).toHaveClass('is-start')
    expect(screen.getByText('Select end date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

    // Hover intermediate day: Oct 15, 2026
    const midBtn = screen.getByRole('button', { name: 'Select date Oct 15, 2026' })
    fireEvent.mouseEnter(midBtn)

    // Second click: Oct 25, 2026 (3-week span: Oct 5 to Oct 25 = 21 days = 3 weeks)
    const endBtn = screen.getByRole('button', { name: 'Select date Oct 25, 2026' })
    await user.click(endBtn)

    expect(startBtn).toHaveClass('is-start')
    expect(endBtn).toHaveClass('is-end')
    expect(screen.getByText(/Oct 5 \u2013 Oct 25, 2026 \u00b7 3 weeks/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(handleChange).toHaveBeenCalledWith({
      period: 'custom',
      startDate: '2026-10-05',
      endDate: '2026-10-25',
    })
  })

  it('discards unapplied changes when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <AnalyticsDateRangePicker
        period="week"
        startDate="2026-10-26"
        endDate="2026-11-01"
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Select Analytics date range/i }))
    await user.click(screen.getByRole('button', { name: 'All time' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(handleChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('WEEKLY')).toBeInTheDocument()
  })
})

