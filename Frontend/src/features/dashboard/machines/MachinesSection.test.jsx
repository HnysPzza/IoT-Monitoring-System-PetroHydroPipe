import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../auth/authSession.jsx'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import MachinesSection from './MachinesSection.jsx'
import { getLiveFeed } from '../live/liveService.js'

vi.mock('../live/liveService.js', () => ({ getLiveFeed: vi.fn() }))

function livePayload({ machine = {}, sensors } = {}) {
  return {
    monitoring: { mode: 'observe', capturedAt: '2026-08-10T02:00:00.000Z' },
    machine: {
      id: 'machine-1',
      machineCode: 'M-01',
      name: 'Spiral Mill 01',
      location: 'Dunggoan',
      status: 'Downtime',
      activeSensors: 1,
      lastUpdated: '2026-08-09T02:00:00.000Z',
      ...machine,
    },
    sensors: sensors || [{
      id: 'sensor-3',
      sensorCode: 'S-03',
      label: 'Machine Main Sensor',
      esp32DeviceId: 'ESP32-03',
      purpose: 'Machine movement authority',
      status: 'Downtime',
      physicalStatus: 'Active',
      signal: 'active',
      lastEventAt: '2026-08-09T02:00:00.000Z',
      monitoring: { stateFresh: true, connectivityState: 'online', detectionState: 'healthy' },
    }],
  }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('MachinesSection live snapshot', () => {
  it('switches between grid and table while keeping live sensor data', async () => {
    const user = userEvent.setup()
    getLiveFeed.mockResolvedValue(livePayload())
    renderWithAuth(<MachinesSection />)
    expect(await screen.findByText('ESP32-03')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Table view' }))
    expect(screen.getByRole('table')).toHaveTextContent('ESP32-03')
    expect(screen.getByRole('button', { name: 'Table view' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(screen.getByText('ESP32-03').closest('article')).toBeInTheDocument()
  })

  it('colors connection based on fresh connectivity', async () => {
    const sensors = [
      { ...livePayload().sensors[0], id: 'online', sensorCode: 'S-01' },
      { ...livePayload().sensors[0], id: 'offline', sensorCode: 'S-02', monitoring: { stateFresh: true, connectivityState: 'offline' } },
      { ...livePayload().sensors[0], id: 'unknown', sensorCode: 'S-03', monitoring: { stateFresh: false, connectivityState: null } },
    ]
    getLiveFeed.mockResolvedValue(livePayload({ sensors }))
    renderWithAuth(<MachinesSection />)
    expect(await screen.findByText('Connected')).toHaveClass('machines-connection-connected')
    expect(screen.getByText('Offline')).toHaveClass('machines-connection-unavailable')
    const card = screen.getByText('S-03').closest('article')
    expect(within(card).getAllByText('Unavailable').find((item) => item.classList.contains('machines-connection-unavailable'))).toBeDefined()
  })

  it('does not invent sensor telemetry or hardware pins', async () => {
    getLiveFeed.mockResolvedValue(livePayload())
    renderWithAuth(<MachinesSection />)
    const card = (await screen.findByText('S-03')).closest('article')
    expect(within(card).getByText('ESP32-03')).toBeInTheDocument()
    expect(within(card).getByText('Unavailable')).toBeInTheDocument()
    expect(within(card).queryByText('Pulse rate')).not.toBeInTheDocument()
    expect(within(card).queryByText(/GPIO|14 \/ min|300s/i)).not.toBeInTheDocument()
  })

  it('F03 does not replace an in-flight snapshot on a polling tick', async () => {
    const timer = vi.spyOn(window, 'setInterval')
    const pending = deferred()
    getLiveFeed.mockReturnValue(pending.promise)
    const view = renderWithAuth(<MachinesSection />)
    await act(async () => { timer.mock.calls.find(([, delay]) => delay === 60000)[0]() })
    expect(getLiveFeed).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(livePayload()) })
    view.unmount()
    timer.mockRestore()
  })
  it('F03 refreshes a mounted machine automatically and removes its timer on unmount', async () => {
    const timer = vi.spyOn(window, 'setInterval')
    const clear = vi.spyOn(window, 'clearInterval')
    getLiveFeed.mockResolvedValue(livePayload())
    const view = renderWithAuth(<MachinesSection />)
    await screen.findByRole('heading', { name: 'Spiral Mill 01' })
    const entry = timer.mock.calls.findIndex(([, delay]) => delay === 60000)
    expect(entry).toBeGreaterThanOrEqual(0)
    getLiveFeed.mockResolvedValue(livePayload({ machine: { name: 'Recovered snapshot' } }))
    await act(async () => { timer.mock.calls[entry][0]() })
    expect(await screen.findByRole('heading', { name: 'Recovered snapshot' })).toBeInTheDocument()
    view.unmount()
    expect(clear).toHaveBeenCalledWith(timer.mock.results[entry].value)
    timer.mockRestore()
    clear.mockRestore()
  })
  beforeEach(() => {
    getLiveFeed.mockReset()
  })

  it('shows a live-snapshot failure, then retries it', async () => {
    const user = userEvent.setup()
    getLiveFeed
      .mockRejectedValueOnce(new Error('Live snapshot failed.'))
      .mockResolvedValueOnce(livePayload())

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Unable to load live machine status' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Live snapshot failed.')
    expect(screen.queryByRole('heading', { name: 'No machines found' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry machines' }))

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(getLiveFeed).toHaveBeenCalledTimes(2)
  })

  it('shows the empty state only when the live snapshot has no machine', async () => {
    getLiveFeed.mockResolvedValue({ machine: null, sensors: [] })

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'No machines found' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unable to load live machine status' })).not.toBeInTheDocument()
  })

  it('keeps the last coherent snapshot after a refresh failure', async () => {
    const user = userEvent.setup()
    getLiveFeed
      .mockResolvedValueOnce(livePayload())
      .mockRejectedValueOnce(new Error('Live refresh failed.'))

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh machines' }))

    const staleNotice = await screen.findByText(/Live machine status is stale/i)
    expect(staleNotice).toHaveTextContent('Live refresh failed.')
    expect(staleNotice.querySelector('time')).toHaveAttribute('dateTime')
    expect(screen.getByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
  })

  it('uses one live snapshot without adding special S-03 card copy', async () => {
    getLiveFeed.mockResolvedValue(livePayload())

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByText('Status snapshot').parentElement.querySelector('time'))
      .toHaveAttribute('dateTime', '2026-08-10T02:00:00.000Z')
    expect(screen.queryByText(/Physical input:/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Downtime')).toHaveLength(2)
    expect(getLiveFeed).toHaveBeenCalledWith('test-token')
    expect(screen.queryByLabelText('Machine status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sensor status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconcile recovery' })).not.toBeInTheDocument()
  })

  it('keeps a sensor fault distinct from downtime status', async () => {
    const faultSensor = livePayload().sensors[0]
    getLiveFeed.mockResolvedValue(livePayload({
      machine: { status: 'Running' },
      sensors: [{ ...faultSensor, status: 'Fault' }],
    }))

    renderWithAuth(<MachinesSection />)

    const faultBadge = await screen.findByText('Fault')
    expect(faultBadge).toHaveClass('status-badge', 'status-fault')
    expect(faultBadge).not.toHaveClass('status-downtime')
    expect(faultBadge.closest('.admin-sensor-card')).toHaveClass('status-fault')
  })

  it('counts returned sensors without claiming they are connected', async () => {
    getLiveFeed.mockResolvedValue(livePayload())

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByText('1 sensor')).toBeInTheDocument()
    expect(screen.queryByText('1 connected')).not.toBeInTheDocument()
  })

  it('describes an empty live snapshot without claiming a connectivity result', async () => {
    getLiveFeed.mockResolvedValue(livePayload({ sensors: [] }))

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByText('No sensors were returned by the live monitoring source.')).toBeInTheDocument()
    expect(screen.queryByText('No sensors are connected to this machine.')).not.toBeInTheDocument()
  })

  it('shows the loading boundary until the live snapshot resolves', async () => {
    const pending = deferred()
    getLiveFeed.mockReturnValue(pending.promise)

    renderWithAuth(<MachinesSection />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading live machine status...')
    await act(async () => { pending.resolve(livePayload()) })
    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
  })

  it('ignores a late snapshot from a prior token', async () => {
    const client = new QueryClient()
    const firstTokenRequest = deferred()
    getLiveFeed
      .mockReturnValueOnce(firstTokenRequest.promise)
      .mockResolvedValueOnce(livePayload({ machine: { name: 'Current token machine' } }))

    function renderTree(token) {
      return (
        <QueryClientProvider client={client}>
          <AuthContext.Provider value={{ token }}>
            <MemoryRouter><MachinesSection /></MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    }

    const view = render(renderTree('first-token'))
    view.rerender(renderTree('second-token'))

    expect(await screen.findByRole('heading', { name: 'Current token machine' })).toBeInTheDocument()
    await act(async () => { firstTokenRequest.resolve(livePayload({ machine: { name: 'Late prior-token machine' } })) })

    await waitFor(() => {
      expect(screen.queryByText('Late prior-token machine')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Current token machine' })).toBeInTheDocument()
    expect(getLiveFeed).toHaveBeenCalledWith('first-token')
    expect(getLiveFeed).toHaveBeenCalledWith('second-token')
  })

  it('portals header controls into the topbar immediately on initial mount when liveFeed is already loaded', () => {
    const client = new QueryClient()
    const payload = livePayload()
    const preloadedFeed = {
      machine: payload.machine,
      sensors: payload.sensors,
      monitoring: payload.monitoring,
      state: 'ready',
      error: '',
      lastUpdated: new Date('2026-08-10T02:00:00.000Z'),
      isRefreshing: false,
      reload: vi.fn(),
    }

    function LayoutShell() {
      return (
        <div>
          <header className="dashboard-topbar">
            <div id="machines-header-controls" data-testid="machines-topbar-slot" />
          </header>
          <Outlet context={{ liveFeed: preloadedFeed }} />
        </div>
      )
    }

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={{ token: 'test-token' }}>
          <MemoryRouter initialEntries={['/dashboard/machines']}>
            <Routes>
              <Route path="/dashboard" element={<LayoutShell />}>
                <Route path="machines" element={<MachinesSection />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    )

    const topbarSlot = screen.getByTestId('machines-topbar-slot')
    const heading = screen.getByRole('heading', { name: 'Spiral Mill 01' })
    const refreshBtn = screen.getByRole('button', { name: 'Refresh machines' })
    expect(topbarSlot).toContainElement(heading)
    expect(topbarSlot).toContainElement(refreshBtn)
    expect(refreshBtn).not.toHaveTextContent('Refresh')
    expect(document.querySelector('.machines-layout .machines-header-controls')).not.toBeInTheDocument()
  })
})
