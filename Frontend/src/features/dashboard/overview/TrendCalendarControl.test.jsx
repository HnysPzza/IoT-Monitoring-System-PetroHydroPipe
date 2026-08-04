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

  it('normalizes a monthly selection to the first local day of the month', async () => {
    const user = userEvent.setup()
    const { onDateChange } = renderCalendar({
      mode: 'month',
      rangeLabel: 'July 2026',
    })

    await user.click(screen.getByRole('button', { name: /selected period/i }))
    await user.click(await screen.findByRole('button', { name: /july 8th, 2026/i }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 6, 1))
  })

  it('disables future dates and returns focus on Escape', async () => {
    const user = userEvent.setup()
    renderCalendar({
      mode: 'week',
      rangeLabel: 'Jul 13, 2026 - Jul 19, 2026',
    })

    const trigger = screen.getByRole('button', { name: /selected period/i })
    await user.click(trigger)
    expect(await screen.findByRole('button', { name: /july 21st, 2026/i })).toBeDisabled()
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
})
