import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsSection from './AnalyticsSection.jsx'
import { getManilaDateInputValue } from './analyticsService.js'
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
  it('renders compact header controls with Weekly, Monthly, and icon-only Refresh', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    const { container } = renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    expect(container.querySelector('.analytics-header-row')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select Analytics week' })).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'false')
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
      { period: 'this-week', referenceDate: getManilaDateInputValue() },
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

  it('keeps the header compact with All time and the weekly calendar', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    const { container } = renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monthly' })).toBeInTheDocument()
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

  it('hides KPI comparison only for All time', async () => {
    const user = userEvent.setup()
    const allTimeSnapshot = {
      ...analyticsTestFixture,
      selectionMode: 'all',
      comparisonMode: 'none',
      comparisonClipped: false,
      comparison: null,
      trendAlignment: { ...analyticsTestFixture.trendAlignment, comparisonBucketCount: 0 },
    }
    const loadAnalytics = vi.fn((_token, options) => Promise.resolve(
      options.period === 'all' ? allTimeSnapshot : analyticsTestFixture,
    ))
    const { container } = renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Downtime trend' })).toBeInTheDocument()
    expect(container.querySelectorAll('.analytics-kpi-delta')).toHaveLength(5)

    await user.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() => expect(loadAnalytics).toHaveBeenLastCalledWith(
      'test-token',
      { period: 'all' },
      { signal: expect.any(AbortSignal) },
    ))
    await waitFor(() => expect(container.querySelectorAll('.analytics-kpi-delta')).toHaveLength(0))
    expect(screen.queryByText(/No prior period/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/compared with the prior period/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    await waitFor(() => expect(container.querySelectorAll('.analytics-kpi-delta')).toHaveLength(5))
    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    await waitFor(() => expect(container.querySelectorAll('.analytics-kpi-delta')).toHaveLength(5))
  })

  it('hides the date picker for All time and restores it for a selected period', async () => {
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
    expect(screen.queryByRole('button', { name: 'Select Analytics week' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select Analytics month' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    expect(screen.getByRole('button', { name: 'Select Analytics month' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.getByRole('button', { name: 'Select Analytics week' })).toBeInTheDocument()
  })

  it('keeps the Analytics layout visible while Monthly and All time load', async () => {
    const user = userEvent.setup()
    const monthlyRequest = createDeferred()
    const allTimeRequest = createDeferred()
    const loadAnalytics = vi.fn()
      .mockResolvedValueOnce(analyticsTestFixture)
      .mockReturnValueOnce(monthlyRequest.promise)
      .mockReturnValueOnce(allTimeRequest.promise)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Downtime trend' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    await waitFor(() => expect(loadAnalytics).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('heading', { name: 'Downtime trend' })).toBeInTheDocument()
    expect(screen.getByText('Loading selected period; previous results remain visible.')).toBeInTheDocument()
    await act(async () => monthlyRequest.resolve(analyticsTestFixture))
    await waitFor(() => expect(screen.queryByText('Loading selected period; previous results remain visible.')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() => expect(loadAnalytics).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('heading', { name: 'Downtime trend' })).toBeInTheDocument()
    expect(screen.getByText('Loading selected period; previous results remain visible.')).toBeInTheDocument()
    await act(async () => allTimeRequest.resolve(analyticsTestFixture))
    await waitFor(() => expect(screen.queryByText('Loading selected period; previous results remain visible.')).not.toBeInTheDocument())
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

  it('opens the weekly picker from the header', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select Analytics week' }))
    expect(screen.getByRole('dialog', { name: 'Select Analytics week' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Select Analytics week' })).toHaveClass('analytics-date-range-popover')
    expect(screen.getByRole('button', { name: 'Select Analytics week' })).toHaveAttribute('aria-expanded', 'true')
    expect(loadAnalytics).toHaveBeenCalledTimes(1)
  })
})

describe('Analytics weekly and monthly selection', () => {
  const originalTime = Date.now()

  beforeEach(() => vi.setSystemTime(new Date('2026-10-22T04:00:00.000Z')))
  afterEach(() => vi.setSystemTime(originalTime))

  it('selects only whole Monday-to-Sunday weeks and keeps Weekly active', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select Analytics week' }))
    expect(screen.getByRole('dialog', { name: 'Select Analytics week' })).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select week Oct 12, 2026 - Oct 18, 2026' }))

    await waitFor(() => expect(loadAnalytics).toHaveBeenLastCalledWith(
      'test-token',
      { period: 'this-week', referenceDate: '2026-10-12' },
      { signal: expect.any(AbortSignal) },
    ))
    const weekPicker = screen.getByRole('button', { name: 'Select Analytics week' })
    expect(weekPicker).toHaveTextContent(/Oct 12\s*–\s*18, 2026/)
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /october 14th, 2026/i })).not.toBeInTheDocument()

    await user.click(weekPicker)
    await user.click(screen.getByRole('button', { name: 'Select week Sep 28, 2026 - Oct 4, 2026' }))
    await waitFor(() => expect(loadAnalytics).toHaveBeenLastCalledWith(
      'test-token',
      { period: 'this-week', referenceDate: '2026-09-28' },
      { signal: expect.any(AbortSignal) },
    ))
    expect(weekPicker).toHaveTextContent(/Sep 28\s*–\s*Oct 4, 2026/)
  })

  it('selects a whole calendar month with no day choices and keeps Monthly active', async () => {
    const user = userEvent.setup()
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    await user.click(screen.getByRole('button', { name: 'Select Analytics month' }))
    expect(screen.getByRole('dialog', { name: 'Select Analytics month' })).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /october 14th, 2026/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sep 2026' }))

    await waitFor(() => expect(loadAnalytics).toHaveBeenLastCalledWith(
      'test-token',
      { period: 'this-month', referenceDate: '2026-09-01' },
      { signal: expect.any(AbortSignal) },
    ))
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('resets the displayed selection to the current week when switching from Monthly', async () => {
    const user = userEvent.setup()
    renderWithAuth(<AnalyticsSection loadAnalytics={vi.fn().mockResolvedValue(analyticsTestFixture)} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Monthly' }))
    await user.click(screen.getByRole('button', { name: 'Select Analytics month' }))
    await user.click(screen.getByRole('button', { name: 'Sep 2026' }))
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    await user.click(screen.getByRole('button', { name: 'Select Analytics week' }))

    expect(screen.getByRole('button', { name: 'Select week Oct 19, 2026 - Oct 25, 2026' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true')
  })
})
