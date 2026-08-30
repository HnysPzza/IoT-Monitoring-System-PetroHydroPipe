import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsSection from './AnalyticsSection.jsx'
import { analyticsTestFixture } from './analyticsTestFixtures.js'

vi.mock('./AnalyticsOperationsDetails.jsx', () => ({
  default: () => <div data-testid="analytics-operations-details" />,
}))

vi.mock('./AnalyticsDateRangePicker.jsx', () => ({
  default: ({ onChange }) => (
    <div>
      <button type="button" onClick={() => onChange({ startDate: '2026-08-15', endDate: '' })}>Choose partial range</button>
      <button type="button" onClick={() => onChange({ startDate: '2026-08-15', endDate: '2026-08-17' })}>Choose complete range</button>
    </div>
  ),
}))

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

describe('AnalyticsSection recorded-data states', () => {
  it('shows loading and the backend data-coverage warning', async () => {
    const deferred = createDeferred()
    const loadAnalytics = vi.fn(() => deferred.promise)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)

    expect(screen.getByText('Loading Analytics...')).toBeInTheDocument()
    deferred.resolve(analyticsTestFixture)

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    expect(screen.queryByText('Recorded system data')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Historical sensor heartbeat coverage is not stored/i)
    expect(screen.queryByText(/Prior period:/i)).not.toBeInTheDocument()
    expect(loadAnalytics).toHaveBeenCalledWith('test-token', { period: 'this-week' })
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

  it('does not request Analytics while a custom range is incomplete and requests exact dates once complete', async () => {
    const loadAnalytics = vi.fn().mockResolvedValue(analyticsTestFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    await waitFor(() => expect(loadAnalytics).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose partial range' }))
    expect(loadAnalytics).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Choose complete range' }))
    await waitFor(() => expect(loadAnalytics).toHaveBeenLastCalledWith('test-token', {
      period: 'custom', startDate: '2026-08-15', endDate: '2026-08-17',
    }))
  })

  it('switches the trend explorer metric from an interactive KPI card', async () => {
    const user = userEvent.setup()
    renderWithAuth(<AnalyticsSection loadAnalytics={vi.fn().mockResolvedValue(analyticsTestFixture)} />)
    expect(await screen.findByRole('heading', { name: 'Operational trend' })).toBeInTheDocument()

    const availabilityCard = screen.getByRole('button', {
      name: /Availability.*Server-calculated operational availability/i,
    })
    await user.click(availabilityCard)
    expect(availabilityCard).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Availability - daily buckets/i)).toBeInTheDocument()
  })

  it('offers all recorded history as a backend-owned range choice', async () => {
    const user = userEvent.setup()
    const allTimeFixture = {
      ...analyticsTestFixture,
      selectionMode: 'all',
      selected: {
        ...analyticsTestFixture.selected,
        range: {
          ...analyticsTestFixture.selected.range,
          requestedStartDate: '2024-01-15',
          requestedEndDate: '2026-08-15',
          daysInclusive: 944,
          bucket: 'monthly',
        },
      },
    }
    const loadAnalytics = vi.fn()
      .mockResolvedValueOnce(analyticsTestFixture)
      .mockResolvedValueOnce(allTimeFixture)
    renderWithAuth(<AnalyticsSection loadAnalytics={loadAnalytics} />)
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All time' }))

    await waitFor(() => expect(loadAnalytics).toHaveBeenLastCalledWith('test-token', { period: 'all' }))
    expect(screen.queryByText(/All recorded history:/i)).not.toBeInTheDocument()
  })
})
