import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsSection from './AnalyticsSection.jsx'
import { analyticsTestFixture } from './analyticsTestFixtures.js'

vi.mock('./AnalyticsOperationsDetails.jsx', () => ({
  default: () => <div data-testid="analytics-operations-details" />,
}))

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

describe('AnalyticsSection recorded-data states', () => {
  it('renders compact header controls with Custom range and icon-only Refresh', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    const { container } = renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    expect(container.querySelector('.analytics-header-row')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom date range' })).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByRole('button', { name: 'Refresh data' })).toHaveTextContent('')
    expect(screen.getByRole('button', { name: 'Analytics data coverage information' })).toBeInTheDocument()
  })

  it('refreshes server-owned bucket states while the page remains open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)

    try {
      renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
      expect(await screen.findByRole('heading', { name: 'Downtime trend' })).toBeInTheDocument()
      expect(loadAnalytics).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(60 * 1000)
      await waitFor(() => expect(loadAnalytics).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves the backend data-coverage caveat into the Analytics info popover', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred()
    const loadAnalytics = vi.fn(() => deferred.promise)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(screen.getByText('Loading Analytics...')).toBeInTheDocument()
    deferred.resolve(analyticsTestFixture)

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    expect(screen.queryByText('Recorded system data')).not.toBeInTheDocument()
    expect(screen.queryByText(/Historical sensor heartbeat coverage is not stored/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Analytics data coverage information' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/Historical sensor heartbeat coverage is not stored/i)
    expect(screen.queryByText(/Prior period:/i)).not.toBeInTheDocument()
    expect(loadAnalytics).toHaveBeenCalledWith(
      'test-token',
      { period: 'this-week' },
      { signal: expect.any(AbortSignal) },
    )
  }, 15000)

  it('does not show the redundant comparison notice', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue({ ...analyticsTestFixture, comparisonClipped: true })
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    expect(screen.queryByText(/Prior period:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/comparison is clipped to matching elapsed time/i)).not.toBeInTheDocument()
  })

  it('shows an initial API error and retries into recorded data', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn()
      .mockRejectedValueOnce(new Error('Analytics temporarily unavailable'))
      .mockResolvedValueOnce(analyticsTestFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(await screen.findByRole('heading', { name: 'Unable to load Analytics' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Analytics temporarily unavailable')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
  }, 15000)

  it('keeps the last successful recorded result visible when refresh fails', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn()
      .mockResolvedValueOnce(analyticsTestFixture)
      .mockRejectedValueOnce(new Error('Refresh unavailable'))
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last recorded result because refresh failed.')
    expect(screen.getByText('130 min')).toBeInTheDocument()
  })

  it('renders zero and unobserved KPI values without inventing measurements', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue({
      ...analyticsTestFixture,
      selected: {
        ...analyticsTestFixture.selected,
        summary: {
          ...analyticsTestFixture.selected.summary,
          downtimeMinutes: 0, availabilityPercent: null, outputPieces: 0, processEventCount: 0,
        },
      },
    })
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(await screen.findByText('0 min')).toBeInTheDocument()
    expect(screen.getByText('0 pcs')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('keeps the header compact with All time and a Custom calendar', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    const { container } = renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Custom date range' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All time' })).toBeInTheDocument()
    expect(container.querySelector('.analytics-bucket-summary')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh data' })).toBeInTheDocument()
  })

  it('loads all recorded history when All time is selected', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All time' }))

    await waitFor(() => expect(loadAnalytics).toHaveBeenLastCalledWith(
      'test-token',
      { period: 'all' },
      { signal: expect.any(AbortSignal) },
    ))
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches the trend explorer metric from an interactive KPI card', async () => {
    const user = userEvent.setup()
    renderWithAuth(<AnalyticsSection loadAnalytics={vi.fn().mockResolvedValue(analyticsTestFixture)} />)
    expect(await screen.findByRole('heading', { name: 'Downtime trend' })).toBeInTheDocument()

    const availabilityCard = screen.getByRole('button', {
      name: /Availability.*Server-calculated operational availability/i,
    })
    await user.click(availabilityCard)
    expect(availabilityCard).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Availability - daily buckets/i)).toBeInTheDocument()
  })

  it('opens the custom date-range picker from the header', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Custom date range' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom date range' })).toHaveAttribute('aria-expanded', 'true')
    expect(loadAnalytics).toHaveBeenCalledTimes(1)
  })
})
