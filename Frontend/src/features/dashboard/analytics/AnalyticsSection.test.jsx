import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsSection from './AnalyticsSection.jsx'

vi.mock('./AnalyticsOperationsDetails.jsx', () => ({
  default: () => <div data-testid="analytics-operations-details" />,
}))

const successfulSnapshot = {
  source: 'local-fixture',
  timeZone: 'Asia/Manila',
  machine: { code: 'M-01', name: 'Spiral Mill 01' },
  range: { startDate: '2026-08-10', endDate: '2026-08-16', daysInclusive: 7, bucket: 'daily' },
  downtimeEvents: [{ id: 'downtime-1' }],
  processEvents: [{ id: 'process-1' }],
  productionRecords: [{ date: '2026-08-10', actualPieces: 118 }],
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

describe('AnalyticsSection local request states', () => {
  it('shows an initial loading state before rendering the local fixture identity', async () => {
    const deferred = createDeferred()
    const loadAnalytics = vi.fn(() => deferred.promise)

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(screen.getByText('Loading Analytics workspace...')).toBeInTheDocument()
    deferred.resolve(successfulSnapshot)

    expect(await screen.findByRole('heading', { name: 'Local Analytics preview' })).toBeInTheDocument()
    expect(screen.getByText('Local fixture only')).toBeInTheDocument()
    expect(loadAnalytics).toHaveBeenCalledTimes(1)
  })

  it('shows an initial error and retries into a successful local preview', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn()
      .mockRejectedValueOnce(new Error('Fixture temporarily unavailable'))
      .mockResolvedValueOnce(successfulSnapshot)

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(await screen.findByRole('heading', { name: 'Unable to prepare Analytics' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Fixture temporarily unavailable')

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Local Analytics preview' })).toBeInTheDocument()
    expect(loadAnalytics).toHaveBeenCalledTimes(2)
  })

  it('keeps the last successful local preview visible when a refresh fails', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn()
      .mockResolvedValueOnce(successfulSnapshot)
      .mockRejectedValueOnce(new Error('Refresh unavailable'))

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Local Analytics preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh data' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last local preview because refresh failed.')
    expect(screen.getByRole('heading', { name: 'Local Analytics preview' })).toBeInTheDocument()
  })

  it('uses an explicit empty state when the selected fixture range has no records', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue({
      ...successfulSnapshot,
      downtimeEvents: [],
      processEvents: [],
      productionRecords: [],
    })

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(await screen.findByText('No local Analytics records fall inside this preview range.')).toBeInTheDocument()
  })

  it('updates the local fixture query when the user changes its date preset', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(successfulSnapshot)

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByText('118 pcs')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'This month' }))

    await waitFor(() => {
      expect(loadAnalytics).toHaveBeenLastCalledWith({ period: 'this-month' })
    })
  })

  it('switches the explorer to a separate output trend without mixing units', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(successfulSnapshot)

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Operational trend' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Trend metric'), 'production')

    expect(screen.getByText('Output - daily buckets')).toBeInTheDocument()
    expect(screen.getByText('118 pcs across 7 buckets.')).toBeInTheDocument()
  })

  it('does not load Analytics when a custom calendar range is only partially selected', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(successfulSnapshot)

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Operational trend' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    expect(document.querySelector('.analytics-filter-row')).toHaveClass('analytics-filter-row--custom')
    const calendarTrigger = await screen.findByRole(
      'button',
      { name: /Open custom date range calendar/i },
      { timeout: 5000 },
    )

    await waitFor(() => expect(loadAnalytics).toHaveBeenCalledTimes(2))
    await user.click(calendarTrigger)
    await user.click(screen.getByRole('button', { name: 'Saturday, August 15, 2026' }))

    expect(loadAnalytics).toHaveBeenCalledTimes(2)
  })

  it('loads one exact local request when a valid custom calendar range is completed', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(successfulSnapshot)

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Operational trend' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Custom' }))
    const calendarTrigger = await screen.findByRole(
      'button',
      { name: /Open custom date range calendar/i },
      { timeout: 5000 },
    )

    await waitFor(() => expect(loadAnalytics).toHaveBeenCalledTimes(2))
    await user.click(calendarTrigger)
    await user.click(screen.getByRole('button', { name: 'Saturday, August 15, 2026' }))
    await user.click(screen.getByRole('button', { name: 'Monday, August 17, 2026' }))

    await waitFor(() => {
      expect(loadAnalytics).toHaveBeenCalledTimes(3)
      expect(loadAnalytics).toHaveBeenLastCalledWith({
        period: 'custom',
        startDate: '2026-08-15',
        endDate: '2026-08-17',
      })
    })
  })

  it('switches the trend explorer metric when clicking an interactive KPI card', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(successfulSnapshot)

    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Operational trend' })).toBeInTheDocument()

    const availabilityCard = screen.getByRole('button', { name: /Availability.*Click to plot/i })
    expect(availabilityCard).toHaveAttribute('aria-pressed', 'false')

    await user.click(availabilityCard)

    expect(availabilityCard).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Availability - daily buckets/i)).toBeInTheDocument()
  })
})
