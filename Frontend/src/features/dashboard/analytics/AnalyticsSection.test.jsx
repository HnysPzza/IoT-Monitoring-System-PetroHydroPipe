import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsSection from './AnalyticsSection.jsx'

const successfulSnapshot = {
  source: 'local-fixture',
  timeZone: 'Asia/Manila',
  machine: { code: 'M-01', name: 'Spiral Mill 01' },
  range: { startDate: '2026-08-10', endDate: '2026-08-16', bucket: 'daily' },
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
    expect(screen.getByText(/It has no Analytics backend connection/i)).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Refresh local data' }))

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
})
