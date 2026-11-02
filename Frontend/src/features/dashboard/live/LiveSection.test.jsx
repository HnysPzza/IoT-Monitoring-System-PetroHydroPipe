import { act, screen } from '@testing-library/react'
import { useState } from 'react'
import { onlineManager } from '@tanstack/react-query'
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

  it('labels a cached snapshot stale until a new live fetch confirms it', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    getLiveFeed.mockResolvedValueOnce(payload()).mockReturnValueOnce(pending.promise)
    function ToggleLive() {
      const [show, setShow] = useState(true)
      return <><button onClick={() => setShow((value) => !value)}>Toggle view</button>{show ? <LiveSection /> : null}</>
    }
    renderWithAuth(<ToggleLive />)
    await screen.findByRole('heading', { name: 'Spiral Mill 01' })
    await user.click(screen.getByRole('button', { name: 'Toggle view' }))
    await user.click(screen.getByRole('button', { name: 'Toggle view' }))
    expect(screen.getByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/stale.*updated/i)
    await act(async () => { pending.resolve(payload()); await pending.promise })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('marks the visible snapshot stale as soon as the browser goes offline', async () => {
    renderWithAuth(<LiveSection />)
    await screen.findByRole('heading', { name: 'Spiral Mill 01' })
    act(() => onlineManager.setOnline(false))
    expect(screen.getByRole('alert')).toHaveTextContent(/live data is stale.*offline/i)
    await act(async () => { onlineManager.setOnline(true); await Promise.resolve() })
  })

  it('keeps a late response stale after the browser goes offline', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    getLiveFeed.mockResolvedValueOnce(payload()).mockReturnValueOnce(pending.promise)
    renderWithAuth(<LiveSection />)
    await screen.findByRole('heading', { name: 'Spiral Mill 01' })
    await user.click(screen.getByRole('button', { name: 'Refresh live feed' }))
    act(() => onlineManager.setOnline(false))
    await act(async () => { pending.resolve(payload()); await pending.promise })
    expect(screen.getByRole('alert')).toHaveTextContent(/live data is stale.*offline/i)
    await act(async () => { onlineManager.setOnline(true); await Promise.resolve() })
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

  it('keeps a sensor fault distinct from downtime status', async () => {
    const faultPayload = payload()
    faultPayload.sensors[0].status = 'Fault'
    getLiveFeed.mockResolvedValue(faultPayload)

    renderWithAuth(<LiveSection />)

    const faultBadge = await screen.findByText('Fault')
    expect(faultBadge).toHaveClass('status-badge', 'status-fault')
    expect(faultBadge).not.toHaveClass('status-downtime')
    expect(faultBadge.closest('.live-sensor-card')).toHaveClass('status-fault')
  })

  it('does not overlap automatic polling requests', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    getLiveFeed.mockResolvedValueOnce(payload()).mockReturnValueOnce(pending.promise).mockResolvedValue(payload())
    renderWithAuth(<LiveSection />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(60000); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(2)
    await act(async () => { vi.advanceTimersByTime(60000); await Promise.resolve() })
    expect(getLiveFeed).toHaveBeenCalledTimes(2)

    await act(async () => { pending.resolve(payload()); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(60000); await Promise.resolve() })
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

  it('shows only the idle material changeover banner on live feed and hides it without showing any fault or downtime banner when faulted', async () => {
    const idlePayload = payload()
    const faultPayload = payload()
    faultPayload.sensors[0].status = 'Fault'
    faultPayload.sensors[0].monitoring.detectionState = 'downtime'

    getLiveFeed.mockResolvedValueOnce(idlePayload).mockResolvedValueOnce(faultPayload)
    const user = userEvent.setup()
    renderWithAuth(<LiveSection />)

    const idleText = await screen.findByText(
      'S-01 Raw Material & Coil Joint is idle — within trigger limit for material changeover.',
    )
    expect(idleText.closest('.overview-alert-banner')).toHaveClass('notice-idle')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh live feed' }))

    expect(await screen.findByText('Fault')).toHaveClass('status-badge', 'status-fault')
    expect(
      screen.queryByText('S-01 Raw Material & Coil Joint is idle — within trigger limit for material changeover.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/process issue detected/i)).not.toBeInTheDocument()
  })

  it('keeps the idle banner visible on live feed and shows no fault or downtime banner when unresolved alerts exist in outlet context', async () => {
    getLiveFeed.mockResolvedValue(payload())
    const { Outlet, Route, Routes } = await import('react-router')
    renderWithAuth(
      <Routes>
        <Route
          element={(
            <Outlet
              context={{
                hasTrustedAlertList: true,
                unresolvedAlerts: [{ id: 'alert-1', status: 'Active', message: 'S-04 Outside Filler Wire has no pulse.' }],
              }}
            />
          )}
        >
          <Route index element={<LiveSection />} />
        </Route>
      </Routes>,
    )

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(
      await screen.findByText('S-01 Raw Material & Coil Joint is idle — within trigger limit for material changeover.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('S-04 Outside Filler Wire has no pulse.')).not.toBeInTheDocument()
  })

  it('still shows the idle banner on live feed when the only alert in outlet context has already recovered (recoveryPending)', async () => {
    getLiveFeed.mockResolvedValue(payload())
    const { Outlet, Route, Routes } = await import('react-router')
    renderWithAuth(
      <Routes>
        <Route
          element={(
            <Outlet
              context={{
                hasTrustedAlertList: true,
                unresolvedAlerts: [{
                  id: 'alert-recovered',
                  status: 'Active',
                  message: 'S-03 machine authority reported a physical fault.',
                  metadata: { recoveryPending: true },
                }],
              }}
            />
          )}
        >
          <Route index element={<LiveSection />} />
        </Route>
      </Routes>,
    )

    expect(
      await screen.findByText('S-01 Raw Material & Coil Joint is idle — within trigger limit for material changeover.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('randomly idles 2 process sensors and shows the idle banner with +1 more idle sensor', async () => {
    const { getSensorLabel } = await import('../../../shared/constants/sensorIdentity.js')
    const processCodes = ['S-01', 'S-02', 'S-04']
    const shuffled = [...processCodes].sort(() => Math.random() - 0.5)
    const randomIdlePair = new Set(shuffled.slice(0, 2))
    const orderedIdleCodes = processCodes.filter((code) => randomIdlePair.has(code))

    const multiSensorPayload = {
      ...payload(),
      sensors: ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'].map((code, index) => {
        const isIdle = randomIdlePair.has(code)
        return {
          id: `sensor-${index + 1}`,
          sensorCode: code,
          label: getSensorLabel(code),
          status: isIdle ? 'Idle' : 'Running',
          signal: isIdle ? 'idle' : 'active',
          lastEventAt: '2026-08-22T00:02:00.000Z',
          monitoring: {
            stateFresh: true,
            connectivityState: 'online',
            detectionState: isIdle ? 'grace' : 'running',
          },
        }
      }),
    }

    getLiveFeed.mockResolvedValue(multiSensorPayload)
    renderWithAuth(<LiveSection />)

    const primaryIdleCode = orderedIdleCodes[0]
    const expectedMessage = `${primaryIdleCode} ${getSensorLabel(primaryIdleCode)} is idle — within trigger limit for material changeover.`
    const idleBannerText = await screen.findByText(expectedMessage)
    const banner = idleBannerText.closest('.overview-alert-banner')
    expect(banner).toHaveClass('notice-idle')
    expect(screen.getByText('+1 more idle sensor')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
