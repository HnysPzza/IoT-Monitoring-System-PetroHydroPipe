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

  it('opens the calendar and returns the selected local date', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar()

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: /july 14th, 2026/i }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 6, 14))
    expect(trigger).toHaveFocus()
  }, 15000)

  it('offers months only and returns the first local day of the selected month', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar({
      mode: 'month',
      rangeLabel: 'July 2026',
    })

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /july 8th, 2026/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Jun 2026' }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 5, 1))
  })

  it('offers whole weeks instead of individual day choices', async () => {
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

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 6, 6))
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
})

