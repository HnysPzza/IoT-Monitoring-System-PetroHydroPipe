import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithAuth } from './renderWithAuth.jsx'
import DowntimeSection from '../features/dashboard/downtime/DowntimeSection.jsx'
import { apiRequest } from '../shared/services/apiClient.js'
import { subscribeToServerEvents } from '../shared/services/eventStream.js'

vi.mock('../shared/services/apiClient.js', () => ({ apiRequest: vi.fn() }))
vi.mock('../shared/services/eventStream.js', () => ({ subscribeToServerEvents: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

for (const signal of ['onOpen', 'onRecovery']) {
  it(`reloads a missed S-03 interval on ${signal} without requiring another downtime event`, async () => {
    let handlers
    subscribeToServerEvents.mockImplementation((path, token, suppliedHandlers) => {
      handlers = suppliedHandlers
      return () => {}
    })
    apiRequest.mockResolvedValueOnce({ records: [], summary: { open: 0, resolved: 0, minutes: 0, loss: 0 } })
      .mockResolvedValue({ records: [{
        id: 'interval-1', displayLabel: 'S-03 missed interval', machine: 'Spiral Mill 01', sensor: 'S-03',
        cause: 'Pending Cause Review', startedAt: '2026-09-10T02:00:00Z', endedAt: null,
        status: 'Open', isOpen: true, isCauseEditable: true, needsCauseReview: true,
        durationMinutes: 10, estimatedLoss: 0, notes: '',
      }], summary: { open: 1, resolved: 0, minutes: 10, loss: 0 } })
    renderWithAuth(<DowntimeSection />)
    await screen.findByText('No downtime records match the selected filters.')
    await act(async () => { handlers[signal]?.({ isReconnect: true }) })
    expect(await screen.findByText('S-03 missed interval')).toBeInTheDocument()
  })
}
