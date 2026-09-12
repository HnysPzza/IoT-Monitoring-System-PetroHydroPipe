import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../auth/authSession.jsx'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import MachinesSection from './MachinesSection.jsx'
import { getLiveFeed } from '../live/liveService.js'

vi.mock('../live/liveService.js', () => ({ getLiveFeed: vi.fn() }))

function livePayload({ machine = {}, sensors } = {}) {
  return {
    monitoring: { mode: 'observe', capturedAt: '2026-08-09T02:00:00.000Z' },
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
  it('F03 does not replace an in-flight snapshot on a polling tick', async () => {
    const timer = vi.spyOn(window, 'setInterval')
    const pending = deferred()
    getLiveFeed.mockReturnValue(pending.promise)
    const view = renderWithAuth(<MachinesSection />)
    await act(async () => { timer.mock.calls.find(([, delay]) => delay === 10000)[0]() })
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
    const entry = timer.mock.calls.findIndex(([, delay]) => delay === 10000)
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

  it('uses one live snapshot and labels S-03 physical input separately from downtime authority', async () => {
    getLiveFeed.mockResolvedValue(livePayload())

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByText(/Physical input: Active/)).toBeInTheDocument()
    expect(screen.getAllByText('Downtime')).toHaveLength(2)
    expect(getLiveFeed).toHaveBeenCalledWith('test-token')
    expect(screen.queryByLabelText('Machine status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sensor status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconcile recovery' })).not.toBeInTheDocument()
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
    const firstTokenRequest = deferred()
    getLiveFeed
      .mockReturnValueOnce(firstTokenRequest.promise)
      .mockResolvedValueOnce(livePayload({ machine: { name: 'Current token machine' } }))

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter><MachinesSection /></MemoryRouter>
        </AuthContext.Provider>
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
})
