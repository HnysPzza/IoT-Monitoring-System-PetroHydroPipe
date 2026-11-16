import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TrendCalendarControl from './TrendCalendarControl.jsx'
import '../../../shared/components/ui/Calendar.jsx'

const selectedDate = new Date(2026, 6, 15)
const maxDate = new Date(2026, 6, 20)

function renderCalendar(overrides = {}) {
  const onDateChange = vi.fn()

  render(
    <TrendCalendarControl
      mode="today"
      selectedDate={selectedDate}
      maxDate={maxDate}
      rangeLabel="Jul 15, 2026"
      onDateChange={onDateChange}
      {...overrides}
    />,
  )

  return { onDateChange }
}

describe('TrendCalendarControl', () => {
  it('includes the visible selected period in the trigger accessible name', () => {
    renderCalendar()

    const trigger = screen.getByText('Jul 15, 2026').closest('button')

    expect(trigger).toHaveAccessibleName('SELECTED PERIOD Jul 15, 2026')
    expect(trigger).not.toHaveAttribute('aria-label')
  })

  it('stages a clicked local date and waits for Apply before committing', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar()

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: /july 14th, 2026/i }))

    expect(onDateChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Jul 14, 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 6, 14))
    expect(trigger).toHaveFocus()
  }, 15000)

  it('offers months only and commits the first local day of the selected month on Apply', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar({
      mode: 'month',
      rangeLabel: 'July 2026',
    })

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /july 8th, 2026/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Jun 2026' }))

    expect(onDateChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('June 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 5, 1))
  })

  it('offers whole weeks instead of individual day choices and commits on Apply', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar({
      mode: 'week',
      rangeLabel: 'Jul 13, 2026 - Jul 19, 2026',
    })

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Select chart week')
    expect(screen.queryByRole('button', { name: /july 14th, 2026/i })).not.toBeInTheDocument()
    const selectedWeek = screen.getByRole('button', { name: /select week jul 13, 2026 - jul 19, 2026/i })
    expect(selectedWeek).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /select week jul 6, 2026 - jul 12, 2026/i }))

    expect(onDateChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 6, 6))
  })

  it('discards a staged date click when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar()

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    const day14 = await screen.findByRole('button', { name: /july 14th, 2026/i })
    await user.click(day14)

    expect(day14).toHaveAttribute('aria-pressed', 'true')
    expect(onDateChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDateChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    expect(await screen.findByRole('button', { name: /july 15th, 2026/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /july 14th, 2026/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks future weeks and returns focus on Escape', async () => {
    const user = userEvent.setup()
    renderCalendar({
      mode: 'week',
      rangeLabel: 'Jul 13, 2026 - Jul 19, 2026',
    })

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)
    expect(await screen.findByRole('button', { name: /select week jul 27, 2026 - aug 2, 2026/i })).toBeDisabled()
    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
  })

  it('closes without changing the date when the user clicks outside', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar()

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    expect(await screen.findByRole('grid')).toBeInTheDocument()
    await user.click(document.body)
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(onDateChange).not.toHaveBeenCalled()
  })

  it('renders quick presets sidebar and switches calendar view when preset is clicked', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    renderCalendar({ onModeChange })

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)

    const dailyPreset = screen.getByRole('button', { name: 'Daily' })
    const weeklyPreset = screen.getByRole('button', { name: 'Weekly' })
    const monthlyPreset = screen.getByRole('button', { name: 'Monthly' })

    expect(dailyPreset).toBeInTheDocument()
    expect(weeklyPreset).toBeInTheDocument()
    expect(monthlyPreset).toBeInTheDocument()
    expect(dailyPreset).toHaveAttribute('aria-pressed', 'true')

    // Click Weekly preset
    await user.click(weeklyPreset)
    expect(onModeChange).toHaveBeenCalledWith('week')
    const weekButtons = await screen.findAllByRole('button', { name: /select week/i })
    expect(weekButtons.length).toBeGreaterThan(0)

    // Click Monthly preset
    await user.click(monthlyPreset)
    expect(onModeChange).toHaveBeenCalledWith('month')
    expect(await screen.findByRole('button', { name: 'Jun 2026' })).toBeInTheDocument()
  })

  it('renders footer with summary and supports Apply and Cancel actions', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar()

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    const applyButton = screen.getByRole('button', { name: 'Apply' })
    expect(applyButton).toBeInTheDocument()

    // Clicking Apply applies current selection and closes popover
    await user.click(applyButton)
    expect(onDateChange).toHaveBeenCalled()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('closes popover without calling onDateChange when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar()

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDateChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('dynamically updates footer selection summary when switching presets', async () => {
    const user = userEvent.setup()
    renderCalendar({ rangeLabel: 'Jul 15, 2026' })

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)

    const footerText = document.querySelector('.trend-popover-footer-text')
    expect(footerText).toHaveTextContent('Jul 15, 2026')

    // Switch to Weekly preset -> footer updates dynamically to week span
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(footerText).toHaveTextContent(/Jul 13, 2026 - Jul 19, 2026 · 1 week/i)

    // Switch to Monthly preset -> footer updates dynamically to month
    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    expect(footerText).toHaveTextContent(/July 2026/i)
  })

  it('does not invent a date when Apply is clicked without an active date', async () => {
    const user = userEvent.setup()
    const onDateChange = vi.fn()
    render(
      <TrendCalendarControl
        mode="today"
        selectedDate={undefined}
        rangeLabel=""
        onDateChange={onDateChange}
      />,
    )

    const trigger = screen.getByRole('button')
    await user.click(trigger)

    const applyButton = screen.getByRole('button', { name: 'Apply' })
    await user.click(applyButton)

    expect(onDateChange).not.toHaveBeenCalled()
  })

  it('highlights the active date across daily, weekly, and monthly views', async () => {
    const user = userEvent.setup()
    renderCalendar()

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)

    // Daily mode: July 15th button is selected
    const day15 = await screen.findByRole('button', { name: /july 15th, 2026/i })
    expect(day15).toHaveClass('is-selected')

    // Weekly mode: Week of July 13-19 is selected
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    const weekRow = await screen.findByRole('button', { name: /select week jul 13, 2026 - jul 19, 2026/i })
    expect(weekRow).toHaveClass('is-selected')

    // Monthly mode: July month button is selected
    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    const julMonth = await screen.findByRole('button', { name: 'Jul 2026' })
    expect(julMonth).toHaveClass('is-selected')
    expect(julMonth).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Aug 2026' })).toBeDisabled()
  })

  it('supports Custom Range selection and applies startDate and endDate', async () => {
    const user = userEvent.setup()
    const onRangeChange = vi.fn()
    const onModeChange = vi.fn()
    renderCalendar({
      presets: [
        { id: 'today', label: 'Daily' },
        { id: 'week', label: 'Weekly' },
        { id: 'month', label: 'Monthly' },
        { id: 'custom', label: 'Custom Range' },
      ],
      onRangeChange,
      onModeChange,
    })

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    await user.click(screen.getByRole('button', { name: 'Custom Range' }))
    expect(onModeChange).toHaveBeenCalledWith('custom')

    await user.click(await screen.findByRole('button', { name: /july 10th, 2026/i }))
    await user.click(await screen.findByRole('button', { name: /july 14th, 2026/i }))

    const footerText = document.querySelector('.trend-popover-footer-text')
    expect(footerText).toHaveTextContent(/Jul 10, 2026 - Jul 14, 2026 · 5 days/i)

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onRangeChange).toHaveBeenCalledWith({
      startDate: new Date(2026, 6, 10),
      endDate: new Date(2026, 6, 14),
    })
  })

  it('reverts previewed preset mode back to initial mode when closed via Cancel or Escape without applying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onModeChange = vi.fn()
    const onRangeChange = vi.fn()

    try {
      renderCalendar({
        mode: 'today',
        onModeChange,
        onRangeChange,
      })

      await user.click(screen.getByRole('button', { name: /selected period/i }))
      await user.click(screen.getByRole('button', { name: 'Weekly' }))
      expect(onModeChange).toHaveBeenCalledWith('week')

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onModeChange).toHaveBeenLastCalledWith('today')

      await user.click(screen.getByRole('button', { name: /selected period/i }))
      await user.click(screen.getByRole('button', { name: 'Monthly' }))
      expect(onModeChange).toHaveBeenLastCalledWith('month')

      await user.keyboard('{Escape}')
      expect(onModeChange).toHaveBeenLastCalledWith('today')
    } finally {
      vi.useRealTimers()
    }
  })

  it('disables forward navigation controls when viewing the maximum allowed month or year', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      renderCalendar({
        mode: 'today',
        selectedDate: new Date(2026, 6, 20),
        maxDate: new Date(2026, 6, 20),
      })

      await user.click(screen.getByRole('button', { name: /selected period/i }))
      expect(screen.getByRole('button', { name: /next month/i })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Monthly' }))
      expect(screen.getByRole('button', { name: /next year/i })).toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('structures the daily calendar with ARIA rows, columnheaders, gridcells, and supports arrow-key navigation', async () => {
    const user = userEvent.setup()
    renderCalendar()

    await user.click(screen.getByRole('button', { name: /selected period/i }))

    const grid = await screen.findByRole('grid')
    const columnHeaders = grid.querySelectorAll('[role="columnheader"]')
    expect(columnHeaders.length).toBe(7)
    expect(columnHeaders[0].closest('[aria-hidden="true"]')).toBeNull()
    expect(grid.querySelectorAll('[role="row"]').length).toBeGreaterThanOrEqual(5)
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(35)

    const day14 = await screen.findByRole('button', { name: /july 14th, 2026/i })
    const day15 = await screen.findByRole('button', { name: /july 15th, 2026/i })
    const day8 = await screen.findByRole('button', { name: /july 8th, 2026/i })

    day15.focus()
    expect(day15).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(day14).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(day15).toHaveFocus()

    await user.keyboard('{ArrowUp}')
    expect(day8).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(day15).toHaveFocus()
  })

  it('supports arrow-key navigation in Weekly and Monthly views and optional Custom range preset', async () => {
    const user = userEvent.setup()
    renderCalendar({ enableCustomRange: true })

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    expect(screen.getByRole('button', { name: 'Custom range' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    const week1 = await screen.findByRole('button', { name: /select week jun 29, 2026 - jul 5, 2026/i })
    const week2 = screen.getByRole('button', { name: /select week jul 6, 2026 - jul 12, 2026/i })
    week1.focus()
    await user.keyboard('{ArrowDown}')
    expect(week2).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(week1).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    const jan = await screen.findByRole('button', { name: 'Jan 2026' })
    const feb = screen.getByRole('button', { name: 'Feb 2026' })
    const apr = screen.getByRole('button', { name: 'Apr 2026' })
    jan.focus()
    await user.keyboard('{ArrowRight}')
    expect(feb).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(jan).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(apr).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(jan).toHaveFocus()
  })

  it('calls onClear and closes the popover when Clear is enabled and clicked', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    renderCalendar({ enableCustomRange: true, canClear: true, onClear })

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

