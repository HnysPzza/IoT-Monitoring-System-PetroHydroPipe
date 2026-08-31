import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsDateRangePicker from './AnalyticsDateRangePicker.jsx'

function renderPicker(props = {}) {
  const onChange = vi.fn()

  renderWithAuth(
    <AnalyticsDateRangePicker
      startDate="2026-08-10"
      endDate="2026-08-14"
      onChange={onChange}
      {...props}
    />,
  )

  return { onChange }
}

describe('AnalyticsDateRangePicker', () => {
  it('renders visible, accessible start and end date fields', () => {
    renderPicker()

    expect(screen.getByText('Custom date range')).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: /month, Start Date/i })).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: /month, End Date/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /Open custom date range calendar/i })).toBeVisible()
  })

  it('exposes all calendar icon controls by their accessible names', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: /Open custom date range calendar/i }))

    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeVisible()
  })

  it('tabs through date segments to the named calendar trigger', async () => {
    const user = userEvent.setup()
    renderPicker()
    const startMonth = screen.getByRole('spinbutton', { name: /month, Start Date/i })
    const trigger = screen.getByRole('button', { name: /Open custom date range calendar/i })

    await user.tab()
    expect(startMonth).toHaveFocus()

    for (let index = 0; index < 6; index += 1) {
      await user.tab()
    }

    expect(trigger).toHaveFocus()
  })

  it('opens with the keyboard and restores focus to the trigger on Escape', async () => {
    const user = userEvent.setup()
    renderPicker()
    const trigger = screen.getByRole('button', { name: /Open custom date range calendar/i })

    trigger.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog')).toBeVisible()

    await act(async () => {
      await user.keyboard('{Escape}')
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens with Space and supports arrow-key navigation and Enter date selection', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()
    const trigger = screen.getByRole('button', { name: /Open custom date range calendar/i })

    trigger.focus()
    await user.keyboard(' ')

    const augustFifteenth = screen.getByRole('button', { name: 'Saturday, August 15, 2026' })
    augustFifteenth.focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).not.toBe(augustFifteenth)
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement)
    await user.keyboard('{Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits YYYY-MM-DD strings only after a complete range and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()
    const trigger = screen.getByRole('button', { name: /Open custom date range calendar/i })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Saturday, August 15, 2026' }))

    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Monday, August 17, 2026' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-08-15', endDate: '2026-08-17' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
