import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../auth/authSession.jsx'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import { acknowledgeAlert, getAlerts, subscribeToAlerts } from '../alerts/alertsService.js'

vi.mock('../alerts/alertsService.js', () => ({
  acknowledgeAlert: vi.fn(),
  getAlerts: vi.fn(),
  subscribeToAlerts: vi.fn(),
}))

function activeAlert() {
  return {
    id: 'alert-1',
    severity: 'Critical',
    status: 'Active',
    title: 'Inside Filler downtime detected',
    message: 'S-04 Inside Filler has no pulse.',
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('AdminDashboard alerts', () => {
  beforeEach(() => {
    acknowledgeAlert.mockReset()
    getAlerts.mockReset()
    subscribeToAlerts.mockReset()
    subscribeToAlerts.mockReturnValue(() => {})
  })

  it('uses the route title as the dashboard level-one heading', async () => {
    getAlerts.mockReturnValue(new Promise(() => {}))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('labels the reporting navigation group as Analytics', () => {
    getAlerts.mockReturnValue(new Promise(() => {}))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    expect(screen.getByText('Analytics')).toBeInTheDocument()
    expect(screen.queryByText('Analyze')).not.toBeInTheDocument()
  })

  it('shows active alert count and acknowledges an alert without reloading the dashboard', async () => {
    const user = userEvent.setup()

    getAlerts.mockResolvedValue({ alerts: [activeAlert()] })
    acknowledgeAlert.mockResolvedValue({
      alert: {
        ...activeAlert(),
        status: 'Acknowledged',
        acknowledgedAt: '2026-06-11T00:00:00.000Z',
      },
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)

    expect(screen.getByText('S-04 Inside Filler has no pulse.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /acknowledge/i }))

    await waitFor(() => {
      expect(acknowledgeAlert).toHaveBeenCalledWith('test-token', 'alert-1')
    })
    expect(await screen.findByText('Acknowledged')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an unavailable alert status on initial failure and retries without calling it empty', async () => {
    const user = userEvent.setup()
    let streamHandlers
    getAlerts
      .mockRejectedValueOnce(new Error('Alert list failed.'))
      .mockResolvedValueOnce({ alerts: [] })
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, status unavailable/i })
    await user.click(bell)
    expect(await screen.findByRole('alert')).toHaveTextContent('Alert list failed.')
    expect(screen.queryByText('No active alerts.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Alert count unavailable')).toHaveTextContent('—')

    act(() => streamHandlers.onEvent({ payload: { alert: activeAlert() } }))
    expect(screen.getByText('S-04 Inside Filler has no pulse.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open alerts, status unavailable/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Alert list failed.')

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
    expect(screen.getByText('No active alerts.')).toBeInTheDocument()
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it('reconciles an SSE alert received before the pending full list resolves', async () => {
    const user = userEvent.setup()
    const alertListRequest = deferred()
    let streamHandlers
    getAlerts.mockReturnValue(alertListRequest.promise)
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    expect(await screen.findByRole('button', { name: /open alerts, status unavailable/i })).toBeInTheDocument()

    act(() => streamHandlers.onEvent({ payload: { alert: activeAlert() } }))
    await act(async () => {
      alertListRequest.resolve({ alerts: [] })
      await alertListRequest.promise
    })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)
    expect(screen.getByText('S-04 Inside Filler has no pulse.')).toBeInTheDocument()
  })

  it('does not replay a post-load SSE delta into a later polling response', async () => {
    vi.useFakeTimers()
    let streamHandlers
    getAlerts
      .mockResolvedValueOnce({ alerts: [] })
      .mockResolvedValueOnce({ alerts: [] })
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()

    act(() => streamHandlers.onEvent({ payload: { alert: activeAlert() } }))
    expect(screen.getByRole('button', { name: /open alerts, 1 active/i })).toBeInTheDocument()

    act(() => streamHandlers.onFallback())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })

    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  it('replays an acknowledgement completed while fallback polling is in flight', async () => {
    vi.useFakeTimers()
    const pollingRequest = deferred()
    let streamHandlers
    getAlerts
      .mockResolvedValueOnce({ alerts: [activeAlert()] })
      .mockReturnValueOnce(pollingRequest.promise)
    acknowledgeAlert.mockResolvedValue({
      alert: { ...activeAlert(), status: 'Acknowledged' },
    })
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => streamHandlers.onFallback())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(getAlerts).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('Acknowledged')).toBeInTheDocument()

    await act(async () => {
      pollingRequest.resolve({ alerts: [activeAlert()] })
      await pollingRequest.promise
    })

    expect(screen.getByText('Acknowledged')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  it('keeps a failed acknowledgement visible, blocks duplicates, and re-enables only its button', async () => {
    const user = userEvent.setup()
    const acknowledgement = deferred()
    getAlerts.mockResolvedValue({ alerts: [activeAlert()] })
    acknowledgeAlert.mockReturnValue(acknowledgement.promise)

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: /open alerts, 1 active/i }))
    const acknowledgeButton = screen.getByRole('button', { name: /acknowledge/i })
    await user.click(acknowledgeButton)
    await user.click(acknowledgeButton)
    expect(acknowledgeAlert).toHaveBeenCalledTimes(1)
    expect(acknowledgeButton).toBeDisabled()

    await act(async () => {
      acknowledgement.reject(new Error('Acknowledgement failed.'))
      try {
        await acknowledgement.promise
      } catch {
        // The component renders the operation error in the alert item.
      }
    })

    expect(screen.getByText('S-04 Inside Filler has no pulse.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Acknowledgement failed.')
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeEnabled()
  })

  it('preserves stale alerts while polling is degraded and stops the poller on stream recovery', async () => {
    vi.useFakeTimers()
    const streamHandlers = {}
    getAlerts
      .mockResolvedValueOnce({ alerts: [activeAlert()] })
      .mockRejectedValueOnce(new Error('Polling failed.'))
    subscribeToAlerts.mockImplementation((token, handlers) => {
      Object.assign(streamHandlers, handlers)
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('button', { name: /open alerts, 1 active/i })).toBeInTheDocument()

    act(() => streamHandlers.onFallback())
    expect(screen.getByRole('status')).toHaveTextContent('Polling')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Polling failed.')
    expect(screen.getByText('S-04 Inside Filler has no pulse.')).toBeInTheDocument()

    act(() => streamHandlers.onRecovery())
    expect(screen.getByRole('status')).toHaveTextContent('Live')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it('ignores stream callbacks from the previous token session', async () => {
    const handlersByToken = new Map()
    getAlerts
      .mockResolvedValueOnce({ alerts: [activeAlert()] })
      .mockResolvedValueOnce({ alerts: [] })
    subscribeToAlerts.mockImplementation((streamToken, handlers) => {
      handlersByToken.set(streamToken, handlers)
      return vi.fn()
    })

    const user = { id: 'user-1', name: 'admin', role: 'Admin' }
    function renderTree(sessionToken) {
      return (
        <AuthContext.Provider value={{ token: sessionToken, user, logout: vi.fn() }}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <AdminDashboard />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))
    expect(await screen.findByRole('button', { name: /open alerts, 1 active/i })).toBeInTheDocument()

    view.rerender(renderTree('second-token'))
    expect(await screen.findByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()

    act(() => {
      handlersByToken.get('first-token').onEvent({
        payload: { alert: { ...activeAlert(), id: 'late-alert', title: 'Late prior-session alert' } },
      })
      handlersByToken.get('first-token').onFallback()
    })

    expect(screen.queryByText('Late prior-session alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent('Polling')
  })

  it('keeps recovered active alerts visible until the user acknowledges them', async () => {
    const user = userEvent.setup()
    const recoveredAlert = {
      ...activeAlert(),
      metadata: {
        recoveryPending: true,
        recoveredAt: '2026-06-11T00:02:00.000Z',
      },
    }

    getAlerts.mockResolvedValue({ alerts: [recoveredAlert] })
    acknowledgeAlert.mockResolvedValue({
      alert: {
        ...recoveredAlert,
        status: 'Resolved',
        acknowledgedAt: '2026-06-11T00:03:00.000Z',
        resolvedAt: '2026-06-11T00:03:00.000Z',
      },
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)

    expect(screen.getByText('Recovered, waiting for acknowledgement')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /acknowledge/i }))

    await waitFor(() => {
      expect(screen.queryByText('Recovered, waiting for acknowledgement')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  it('closes the alerts dialog with Escape and returns focus to the bell', async () => {
    const user = userEvent.setup()

    getAlerts.mockResolvedValue({ alerts: [activeAlert()] })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)

    expect(screen.getByRole('dialog', { name: /active alerts/i })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /active alerts/i })).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
  })

  it('closes alerts before opening the mobile navigation drawer', async () => {
    const user = userEvent.setup()

    getAlerts.mockResolvedValue({ alerts: [activeAlert()] })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: /open alerts, 1 active/i }))
    await user.click(screen.getByRole('button', { name: /open navigation/i }))

    expect(screen.queryByRole('dialog', { name: /active alerts/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
  })
})
