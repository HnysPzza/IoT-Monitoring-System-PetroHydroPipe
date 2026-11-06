import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductionDateRangePicker, {
  formatRangeDisplay,
  getDisplayLabels,
  getThisMonthRange,
  getThisWeekRange,
  isSameDay,
} from './ProductionDateRangePicker.jsx'

describe('ProductionDateRangePicker Unit & Integration Suite', () => {
  describe('Helper Functions & Formatters', () => {
    it('isSameDay correctly identifies matching calendar dates', () => {
      const d1 = new Date(2026, 10, 1, 10, 0, 0)
      const d2 = new Date(2026, 10, 1, 18, 30, 0)
      const d3 = new Date(2026, 10, 2, 10, 0, 0)
      expect(isSameDay(d1, d2)).toBe(true)
      expect(isSameDay(d1, d3)).toBe(false)
      expect(isSameDay(d1, null)).toBe(false)
    })

    it('getThisWeekRange returns Mon-Sun week boundaries for any given day', () => {
      // 2026-11-01 is a Sunday
      const refSunday = new Date(2026, 10, 1)
      const { startDate, endDate } = getThisWeekRange(refSunday)
      expect(startDate.getFullYear()).toBe(2026)
      expect(startDate.getMonth()).toBe(9) // October
      expect(startDate.getDate()).toBe(26) // Oct 26 Monday
      expect(endDate.getFullYear()).toBe(2026)
      expect(endDate.getMonth()).toBe(10) // November
      expect(endDate.getDate()).toBe(1) // Nov 1 Sunday

      // 2026-11-07 is a Saturday
      const refSaturday = new Date(2026, 10, 7)
      const satRange = getThisWeekRange(refSaturday)
      expect(satRange.startDate.getDate()).toBe(2) // Nov 2 Monday
      expect(satRange.endDate.getDate()).toBe(8) // Nov 8 Sunday
    })

    it('getThisMonthRange returns first to last day of month', () => {
      const ref = new Date(2026, 10, 15) // Nov 15, 2026
      const { startDate, endDate } = getThisMonthRange(ref)
      expect(startDate.getDate()).toBe(1)
      expect(startDate.getMonth()).toBe(10)
      expect(endDate.getDate()).toBe(30)
      expect(endDate.getMonth()).toBe(10)
    })

    it('formatRangeDisplay formats single and multi-day spans properly', () => {
      const oct26 = new Date(2026, 9, 26)
      const nov1 = new Date(2026, 10, 1)
      const nov10 = new Date(2026, 10, 10)
      expect(formatRangeDisplay(nov1, nov1)).toBe('Nov 1, 2026')
      expect(formatRangeDisplay(oct26, nov1)).toBe('Oct 26 – Nov 1, 2026')
      expect(formatRangeDisplay(nov1, nov10)).toBe('Nov 1 – 10, 2026')
      expect(formatRangeDisplay(null, null)).toBe('All Dates')
    })

    it('getDisplayLabels dynamic eyebrow and value mapping matches specification', () => {
      // Default / All Dates
      expect(getDisplayLabels(null)).toEqual({ eyebrow: 'DATE', value: 'All Dates' })
      expect(getDisplayLabels({ type: 'all' })).toEqual({ eyebrow: 'DATE', value: 'All Dates' })

      // Single Day
      expect(getDisplayLabels('2026-11-01')).toEqual({ eyebrow: 'DATE', value: 'Nov 1, 2026' })
      expect(getDisplayLabels({ type: 'day', startDate: '2026-11-01', endDate: '2026-11-01' })).toEqual({
        eyebrow: 'DATE',
        value: 'Nov 1, 2026',
      })

      // Week preset
      expect(getDisplayLabels({ type: 'week', startDate: '2026-10-26', endDate: '2026-11-01' })).toEqual({
        eyebrow: 'WEEKLY',
        value: 'Oct 26 – Nov 1, 2026',
      })

      // Month preset
      expect(getDisplayLabels({ type: 'month', startDate: '2026-11-01', endDate: '2026-11-30' })).toEqual({
        eyebrow: 'MONTHLY',
        value: 'November 2026',
      })

      // Custom multi-day range
      expect(getDisplayLabels({ type: 'range', startDate: '2026-10-26', endDate: '2026-11-01' })).toEqual({
        eyebrow: 'RANGE',
        value: 'Oct 26 – Nov 1, 2026',
      })
    })
  })

  describe('Toolbar Trigger & Clear Button Behavior', () => {
    it('renders single button trigger footprint with dynamic eyebrow and value', () => {
      render(
        <ProductionDateRangePicker
          value={{ type: 'week', startDate: '2026-10-26', endDate: '2026-11-01' }}
          onChange={vi.fn()}
        />,
      )

      const trigger = screen.getByLabelText('Filter by date')
      expect(trigger).toHaveClass('trend-calendar-trigger')
      expect(screen.getByText('WEEKLY')).toBeInTheDocument()
      expect(screen.getByText('Oct 26 – Nov 1, 2026')).toBeInTheDocument()
    })

    it('renders small X clear button inside date button when date is selected and clears filter on click', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      const { rerender } = render(
        <ProductionDateRangePicker
          value={{ type: 'day', startDate: '2026-11-01', endDate: '2026-11-01' }}
          onChange={handleChange}
        />,
      )

      const clearBtn = screen.getByRole('button', { name: 'Clear date filter' })
      expect(clearBtn).toHaveClass('production-date-clear-inline')

      await user.click(clearBtn)
      expect(handleChange).toHaveBeenCalledWith({
        type: 'all',
        startDate: null,
        endDate: null,
      })

      // When value changes to all dates, clear button disappears
      rerender(
        <ProductionDateRangePicker
          value={{ type: 'all', startDate: null, endDate: null }}
          onChange={handleChange}
        />,
      )
      expect(screen.queryByRole('button', { name: 'Clear date filter' })).not.toBeInTheDocument()
    })
  })

  describe('Popover Architecture & Presets', () => {
    it('opens popover dialog on trigger click and displays presets', async () => {
      const user = userEvent.setup()
      render(
        <ProductionDateRangePicker
          value={{ type: 'all' }}
          onChange={vi.fn()}
          accessibleLabel="Select production date"
        />,
      )

      const trigger = screen.getByLabelText('Filter by date')
      await user.click(trigger)

      const dialog = await screen.findByRole('dialog', { name: 'Select production date' })
      expect(dialog).toBeInTheDocument()

      expect(within(dialog).getByRole('button', { name: 'All Dates' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Today' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Monthly' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Custom Range' })).toBeInTheDocument()
    })

    it('selecting Weekly preset updates footer label and applies on Apply click', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <ProductionDateRangePicker
          value={{ type: 'all' }}
          onChange={handleChange}
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))

      const dialog = await screen.findByRole('dialog')
      const weekPresetBtn = within(dialog).getByRole('button', { name: 'Weekly' })
      await user.click(weekPresetBtn)

      expect(weekPresetBtn).toHaveClass('is-active')

      const applyBtn = within(dialog).getByRole('button', { name: 'Apply' })
      await user.click(applyBtn)

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'week',
          startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('Reset button in footer restores staged selection to All Dates', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <ProductionDateRangePicker
          value={{ type: 'day', startDate: '2026-11-01', endDate: '2026-11-01' }}
          onChange={handleChange}
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))

      const dialog = await screen.findByRole('dialog')
      const resetBtn = within(dialog).getByRole('button', { name: 'Reset' })
      await user.click(resetBtn)

      expect(within(dialog).getByText('All Dates', { selector: '.production-popover-selection-label' })).toBeInTheDocument()

      const applyBtn = within(dialog).getByRole('button', { name: 'Apply' })
      await user.click(applyBtn)

      expect(handleChange).toHaveBeenCalledWith({
        type: 'all',
        startDate: null,
        endDate: null,
      })
    })
  })

  describe('Weekly Mode Interaction: Clicking Saturday Highlights Monday to Sunday', () => {
    it('in weekly mode, clicking Saturday selects and highlights entire week from Monday to Sunday', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <ProductionDateRangePicker
          value={{ type: 'all' }}
          onChange={handleChange}
          maxDate="2026-12-31"
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))
      const dialog = await screen.findByRole('dialog')

      // Switch to Weekly mode
      const weeklyBtn = within(dialog).getByRole('button', { name: 'Weekly' })
      await user.click(weeklyBtn)
      expect(weeklyBtn).toHaveClass('is-active')

      // In November 2026: Nov 7 is Saturday. The week is Mon Nov 2 to Sun Nov 8.
      const saturday7 = within(dialog).getByRole('button', { name: /Nov 7, 2026/ })
      expect(saturday7).toBeDefined()

      // Click on Saturday 7
      await user.click(saturday7)

      // Verify Monday Nov 2 and Sunday Nov 8 are selected endpoints
      const monday2 = within(dialog).getByRole('button', { name: /Nov 2, 2026/ })
      const sunday8 = within(dialog).getByRole('button', { name: /Nov 8, 2026/ })
      const wednesday4 = within(dialog).getByRole('button', { name: /Nov 4, 2026/ })

      expect(monday2).toHaveClass('is-selected')
      expect(monday2).toHaveClass('is-week-start')
      expect(sunday8).toHaveClass('is-selected')
      expect(sunday8).toHaveClass('is-week-end')
      expect(wednesday4).toHaveClass('is-selected')
      expect(wednesday4).toHaveClass('is-week-selected')

      // Footer label shows the week range
      expect(within(dialog).getByText(/Nov 2 – 8, 2026/i)).toBeInTheDocument()

      // Click Apply
      const applyBtn = within(dialog).getByRole('button', { name: 'Apply' })
      await user.click(applyBtn)

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'week',
          startDate: expect.stringMatching(/-\d{2}-02$/),
          endDate: expect.stringMatching(/-\d{2}-08$/),
        }),
      )
    })
  })

  describe('Monthly Mode: Shows Only Months Grid', () => {
    it('in monthly mode, calendar shows only 12 months grid and allows selecting a month', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <ProductionDateRangePicker
          value={{ type: 'all' }}
          onChange={handleChange}
          maxDate="2026-12-31"
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))
      const dialog = await screen.findByRole('dialog')

      // Switch to Monthly mode
      const monthlyBtn = within(dialog).getByRole('button', { name: 'Monthly' })
      await user.click(monthlyBtn)
      expect(monthlyBtn).toHaveClass('is-active')

      // All 12 month buttons should exist in the dialog
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      for (const m of months) {
        expect(within(dialog).getByRole('button', { name: m })).toBeInTheDocument()
      }

      // No day of week headers (Su, Mo, etc.) should be in month view
      expect(within(dialog).queryByText('Su')).not.toBeInTheDocument()

      // Click on November ('Nov')
      const novBtn = within(dialog).getByRole('button', { name: 'Nov' })
      await user.click(novBtn)

      expect(novBtn).toHaveClass('is-selected')
      expect(within(dialog).getByText('November 2026', { selector: '.production-popover-selection-label' })).toBeInTheDocument()

      // Click Apply
      const applyBtn = within(dialog).getByRole('button', { name: 'Apply' })
      await user.click(applyBtn)

      expect(handleChange).toHaveBeenCalledWith({
        type: 'month',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
      })
    })

    it('navigates previous year and next year in monthly mode', async () => {
      const user = userEvent.setup()
      render(
        <ProductionDateRangePicker
          value={{ type: 'month', startDate: '2026-11-01', endDate: '2026-11-30' }}
          onChange={vi.fn()}
          maxDate="2027-12-31"
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))
      const dialog = await screen.findByRole('dialog')

      expect(within(dialog).getByText('2026')).toBeInTheDocument()

      const prevYearBtn = within(dialog).getByRole('button', { name: 'Previous year' })
      await user.click(prevYearBtn)
      expect(within(dialog).getByText('2025')).toBeInTheDocument()

      const nextYearBtn = within(dialog).getByRole('button', { name: 'Next year' })
      await user.click(nextYearBtn)
      expect(within(dialog).getByText('2026')).toBeInTheDocument()
    })
  })

  describe('Multi-Day Range Calendar Interactions (Custom Range)', () => {
    it('supports two-click range selection and applies selection', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <ProductionDateRangePicker
          value={{ type: 'all' }}
          onChange={handleChange}
          maxDate="2026-12-31"
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))
      const dialog = await screen.findByRole('dialog')

      // Find day buttons in November
      const dayButtons = await within(dialog).findAllByRole('button')
      const day10 = dayButtons.find((btn) => btn.textContent.trim() === '10')
      const day15 = dayButtons.find((btn) => btn.textContent.trim() === '15')

      expect(day10).toBeDefined()
      expect(day15).toBeDefined()

      // Click 1: sets startDate
      await user.click(day10)
      expect(day10).toHaveClass('is-selected')

      // Click 2: sets endDate
      await user.click(day15)
      expect(day10).toHaveClass('is-selected')
      expect(day15).toHaveClass('is-selected')

      // Intermediate day 12 should have in-range class
      const day12 = dayButtons.find((btn) => btn.textContent.trim() === '12')
      expect(day12).toHaveClass('is-in-range')

      // Click Apply
      const applyBtn = within(dialog).getByRole('button', { name: 'Apply' })
      await user.click(applyBtn)

      expect(handleChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'range',
          startDate: expect.stringMatching(/-\d{2}-10$/),
          endDate: expect.stringMatching(/-\d{2}-15$/),
        }),
      )
    })

    it('handles backward range selection (clicking day 20 then day 10)', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <ProductionDateRangePicker
          value={{ type: 'all' }}
          onChange={handleChange}
          maxDate="2026-12-31"
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))
      const dialog = await screen.findByRole('dialog')

      const dayButtons = await within(dialog).findAllByRole('button')
      const day10 = dayButtons.find((btn) => btn.textContent.trim() === '10')
      const day20 = dayButtons.find((btn) => btn.textContent.trim() === '20')

      // Click 1 on 20
      await user.click(day20)
      // Click 2 on 10 (earlier)
      await user.click(day10)

      const applyBtn = within(dialog).getByRole('button', { name: 'Apply' })
      await user.click(applyBtn)

      // Start date must be normalized to 10 and end date to 20
      expect(handleChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'range',
          startDate: expect.stringMatching(/-\d{2}-10$/),
          endDate: expect.stringMatching(/-\d{2}-20$/),
        }),
      )
    })

    it('marks days after maxDate without disabling them', async () => {
      const user = userEvent.setup()
      render(
        <ProductionDateRangePicker
          value={{ type: 'day', startDate: '2026-11-05', endDate: '2026-11-05' }}
          onChange={vi.fn()}
          maxDate="2026-11-10"
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))
      const dialog = await screen.findByRole('dialog')

      const dayButtons = await within(dialog).findAllByRole('button')
      const day5 = dayButtons.find((btn) => btn.textContent.trim() === '5')
      const day15 = dayButtons.find((btn) => btn.textContent.trim() === '15')

      expect(day5).not.toBeDisabled()
      expect(day15).toBeDisabled()
      expect(day15).toHaveClass('is-future')
    })
  })

  describe('Keyboard & Outside Click Accessibility', () => {
    it('closes popover on Escape key and refocuses trigger', async () => {
      const user = userEvent.setup()
      render(
        <ProductionDateRangePicker
          value={{ type: 'all' }}
          onChange={vi.fn()}
        />,
      )

      const trigger = screen.getByLabelText('Filter by date')
      await user.click(trigger)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    })

    it('navigates previous and next month via arrow buttons in day view', async () => {
      const user = userEvent.setup()
      render(
        <ProductionDateRangePicker
          value={{ type: 'day', startDate: '2026-11-01', endDate: '2026-11-01' }}
          onChange={vi.fn()}
          maxDate="2027-12-31"
        />,
      )

      await user.click(screen.getByLabelText('Filter by date'))
      const dialog = await screen.findByRole('dialog')

      expect(within(dialog).getByText(/November 2026/i)).toBeInTheDocument()

      const prevBtn = within(dialog).getByRole('button', { name: 'Previous month' })
      await user.click(prevBtn)
      expect(within(dialog).getByText(/October 2026/i)).toBeInTheDocument()

      const nextBtn = within(dialog).getByRole('button', { name: 'Next month' })
      await user.click(nextBtn)
      expect(within(dialog).getByText(/November 2026/i)).toBeInTheDocument()
    })
  })
})
