import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import LiveSection from './LiveSection.jsx'
import { getLiveFeed } from './liveService.js'

vi.mock('./liveService.js', () => ({ getLiveFeed: vi.fn() }))

function payload() {
  return {
    monitoring: { mode: 'observe', capturedAt: '2026-08-22T00:02:10.000Z' },
    machine: {
      id: 'machine-1',
      machineCode: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
      location: 'Production Floor',
      activeSensors: 1,
      lastUpdated: '2026-08-22T00:02:00.000Z',
    },
    sensors: [{
      id: 'sensor-1',
      sensorCode: 'S-01',
      label: 'Raw Material Detection',
      status: 'Idle',
      signal: 'idle',
      lastEventAt: '2026-08-22T00:02:00.000Z',
      purpose: 'Detect raw material movement',
      monitoring: {
        stateFresh: true,
        connectivityState: 'online',
        detectionState: 'grace',
      },
    }],
  }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('LiveSection polling', () => {
  beforeEach(() => {
    getLiveFeed.mockReset().mockResolvedValue(payload())
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows watchdog meaning and retains last-good data after a refresh failure', async () => {
    const user = userEvent.setup()
    getLiveFeed.mockResolvedValueOnce(payload()).mockRejectedValueOnce(new Error('Slow connection'))
    renderWithAuth(<LiveSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByText('Idle — grace period')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Live feed controls' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Filter sensors by status' })).not.toBeInTheDocument()
    const refreshButton = screen.getByRole('button', { name: 'Refresh live feed' })
    expect(refreshButton).toHaveClass('icon-button')
    expect(refreshButton).toHaveTextContent('')
    expect(refreshButton.closest('.live-hero-card')).not.toBeNull()
    expect(refreshButton.nextElementSibling).toHaveTextContent('Watchdog observe')
    expect(refreshButton.querySelector('svg')).toHaveAttribute('stroke-width', '2.4')
    await user.click(refreshButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Live data is stale.*Slow connection/i)
    expect(screen.getByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByText('Idle — grace period')).toBeInTheDocument()
  })

  it('does not overlap automatic polling requests', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    getLiveFeed.mockResolvedValueOnce(payload()).mockReturnValueOnce(pending.promise).mockResolvedValue(payload())
    renderWithAuth(<LiveSection />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(15000); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(2)
    await act(async () => { vi.advanceTimersByTime(45000); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(2)

    await act(async () => { pending.resolve(payload()); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(15000); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(3)
  })

  it('pauses polling while hidden and refreshes when visible again', async () => {
    vi.useFakeTimers()
    renderWithAuth(<LiveSection />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => { vi.advanceTimersByTime(30000); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getLiveFeed).toHaveBeenCalledTimes(2)
  })
})
