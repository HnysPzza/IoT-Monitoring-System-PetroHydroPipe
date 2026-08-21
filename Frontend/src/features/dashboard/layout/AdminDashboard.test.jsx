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
    revision: '1',
  }
}

function alertSnapshot(alerts, snapshotRevision = alerts.reduce((highest, alert) => (
  BigInt(alert.revision) > BigInt(highest) ? alert.revision : highest
), '0')) {
  return { alerts, snapshotRevision }
}

function alertAtRevision(revision, overrides = {}) {
  return { ...activeAlert(), revision, ...overrides }
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

function createControllableMatchMedia(initialMatches = false) {
  let matches = initialMatches
  const listeners = new Set()
  const mediaQuery = {
    media: '(max-width: 900px)',
    get matches() {
      return matches
    },
    onchange: null,
    addEventListener: vi.fn((type, listener) => {
      if (type === 'change') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type, listener) => {
      if (type === 'change') listeners.delete(listener)
    }),
  }

  return {
    matchMedia: vi.fn(() => mediaQuery),
    setMatches(nextMatches) {
      matches = nextMatches
      const event = { matches, media: mediaQuery.media }
      mediaQuery.onchange?.(event)
      listeners.forEach((listener) => listener(event))
    },
  }
}

describe('AdminDashboard alerts', () => {
  beforeEach(() => {
    acknowledgeAlert.mockReset()
    getAlerts.mockReset()
    subscribeToAlerts.mockReset()
    subscribeToAlerts.mockReturnValue(() => { })
  })

  it('uses the route title as the dashboard level-one heading', async () => {
    getAlerts.mockReturnValue(new Promise(() => { }))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('labels the reporting navigation group as Analytics', () => {
    getAlerts.mockReturnValue(new Promise(() => { }))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    expect(screen.getByText('Analytics', { selector: '.sidebar-nav-heading' })).toBeInTheDocument()
    expect(screen.queryByText('Analyze', { selector: '.sidebar-nav-heading' })).not.toBeInTheDocument()
  })

  it('renders the requested Lucide icons while keeping Reports on BarChart3', () => {
    getAlerts.mockReturnValue(new Promise(() => { }))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const liveFeedIcon = screen.getByRole('link', { name: 'Live Feed' }).querySelector('svg')
    const reportsIcon = screen.getByRole('link', { name: 'Reports' }).querySelector('svg')
    const analyticsIcon = screen.getByRole('link', { name: 'Analytics' }).querySelector('svg')
    const auditLogIcon = screen.getByRole('link', { name: 'Audit Log' }).querySelector('svg')

    expect(liveFeedIcon).toHaveClass('lucide-rss')
    expect(reportsIcon).toHaveClass('lucide-chart-column')
    expect(analyticsIcon).toHaveClass('lucide-chart-no-axes-combined')
    expect(auditLogIcon).toHaveClass('lucide-logs')
    expect(auditLogIcon).toHaveAttribute('stroke-width', '2.25')
  })

  it('keeps the sidebar scrollbar visible while navigation is being scrolled', () => {
    vi.useFakeTimers()
    getAlerts.mockReturnValue(new Promise(() => { }))

    const view = renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    const sidebarNav = screen.getByRole('navigation', { name: 'Dashboard sections' })

    fireEvent.scroll(sidebarNav)
    act(() => {
      vi.advanceTimersByTime(250)
    })
    fireEvent.scroll(sidebarNav)
    expect(sidebarNav).toHaveClass('is-scrolling')

    act(() => {
      vi.advanceTimersByTime(251)
    })
    expect(sidebarNav).toHaveClass('is-scrolling')

    act(() => {
      vi.advanceTimersByTime(248)
    })
    expect(sidebarNav).toHaveClass('is-scrolling')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(sidebarNav).not.toHaveClass('is-scrolling')

    view.unmount()
  })

  it('clears the sidebar scrollbar timer on unmount', () => {
    vi.useFakeTimers()
    getAlerts.mockReturnValue(new Promise(() => { }))

    const view = renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    const sidebarNav = screen.getByRole('navigation', { name: 'Dashboard sections' })

    fireEvent.scroll(sidebarNav)
    expect(sidebarNav).toHaveClass('is-scrolling')
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(500)
      })
    }).not.toThrow()
  })

  it('shows active alert count and acknowledges an alert without reloading the dashboard', async () => {
    const user = userEvent.setup()

    getAlerts.mockResolvedValue(alertSnapshot([activeAlert()]))
    acknowledgeAlert.mockResolvedValue({
      alert: {
        ...activeAlert(),
        status: 'Acknowledged',
        acknowledgedAt: '2026-06-11T00:00:00.000Z',
        revision: '2',
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
    vi.unstubAllGlobals()
  })

  it('shows an unavailable alert status on initial failure and retries without calling it empty', async () => {
    const user = userEvent.setup()
    let streamHandlers
    getAlerts
      .mockRejectedValueOnce(new Error('Alert list failed.'))
      .mockResolvedValueOnce(alertSnapshot([], '1'))
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

    act(() => streamHandlers.onEvent({ type: 'alert.created', payload: { alert: activeAlert() } }))
    expect(screen.getByText('S-04 Inside Filler has no pulse.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open alerts, status unavailable/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Alert list failed.')

    const retryAt = Date.now() + 5000
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(retryAt)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    dateNow.mockRestore()

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

    act(() => streamHandlers.onEvent({ type: 'alert.created', payload: { alert: activeAlert() } }))
    await act(async () => {
      alertListRequest.resolve(alertSnapshot([]))
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
      .mockResolvedValueOnce(alertSnapshot([]))
      .mockResolvedValueOnce(alertSnapshot([], '1'))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()

    act(() => streamHandlers.onEvent({ type: 'alert.created', payload: { alert: activeAlert() } }))
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
      .mockResolvedValueOnce(alertSnapshot([activeAlert()]))
      .mockReturnValueOnce(pollingRequest.promise)
    acknowledgeAlert.mockResolvedValue({
      alert: { ...activeAlert(), status: 'Acknowledged', revision: '2' },
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
      pollingRequest.resolve(alertSnapshot([activeAlert()]))
      await pollingRequest.promise
    })

    expect(screen.getByText('Acknowledged')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  it('keeps a failed acknowledgement visible, blocks duplicates, and re-enables only its button', async () => {
    const user = userEvent.setup()
    const acknowledgement = deferred()
    getAlerts.mockResolvedValue(alertSnapshot([activeAlert()]))
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
      .mockResolvedValueOnce(alertSnapshot([activeAlert()]))
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

  it('coalesces reconnect flapping into one non-parallel trailing snapshot request', async () => {
    vi.useFakeTimers()
    const initialRequest = deferred()
    const trailingRequest = deferred()
    let streamHandlers
    getAlerts
      .mockReturnValueOnce(initialRequest.promise)
      .mockReturnValueOnce(trailingRequest.promise)
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    expect(getAlerts).toHaveBeenCalledTimes(1)

    act(() => {
      streamHandlers.onOpen({ isReconnect: false, isRetry: false })
      streamHandlers.onOpen({ isReconnect: false, isRetry: true })
      streamHandlers.onOpen({ isReconnect: true, isRetry: false })
      streamHandlers.onOpen({ isReconnect: true, isRetry: true })
    })
    expect(getAlerts).toHaveBeenCalledTimes(1)

    await act(async () => {
      initialRequest.resolve(alertSnapshot([]))
      await initialRequest.promise
    })
    act(() => {
      streamHandlers.onOpen({ isReconnect: true, isRetry: false })
      streamHandlers.onOpen({ isReconnect: true, isRetry: false })
    })

    await vi.advanceTimersByTimeAsync(4999)
    expect(getAlerts).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getAlerts).toHaveBeenCalledTimes(2)

    await act(async () => {
      trailingRequest.resolve(alertSnapshot([]))
      await trailingRequest.promise
    })
    await vi.advanceTimersByTimeAsync(10000)
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it('repairs the snapshot-to-first-stream-open missed window without another SSE delta', async () => {
    vi.useFakeTimers()
    let streamHandlers
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([alertAtRevision('10')], '10'))
      .mockResolvedValueOnce(alertSnapshot([alertAtRevision('11', { title: 'Missed revision 11' })], '11'))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    act(() => streamHandlers.onOpen({ isReconnect: false, isRetry: false }))

    await vi.advanceTimersByTimeAsync(4999)
    expect(getAlerts).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getAlerts).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    expect(screen.getByText('Missed revision 11')).toBeInTheDocument()
  })

  it('ignores heartbeats but repairs an alert transition with a missing payload', async () => {
    vi.useFakeTimers()
    let streamHandlers
    getAlerts.mockResolvedValue(alertSnapshot([]))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    act(() => streamHandlers.onEvent({ type: 'heartbeat', payload: { ok: true } }))
    await vi.advanceTimersByTimeAsync(5000)
    expect(getAlerts).toHaveBeenCalledTimes(1)

    act(() => streamHandlers.onEvent({ type: 'alert.updated', payload: {} }))
    await vi.advanceTimersByTimeAsync(0)
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it('coalesces unknown alert event names and malformed alert records into one repair', async () => {
    vi.useFakeTimers()
    let streamHandlers
    getAlerts.mockResolvedValue(alertSnapshot([]))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    act(() => {
      streamHandlers.onEvent({
        type: 'alert.future',
        payload: { alert: alertAtRevision('1') },
      })
      streamHandlers.onEvent({
        type: 'alert.updated',
        payload: { alert: { revision: '1', status: 'Active' } },
      })
      streamHandlers.onEvent({
        type: 'alert.updated',
        payload: { alert: alertAtRevision('01') },
      })
      streamHandlers.onEvent({
        type: 'alert.resolved',
        payload: { alert: alertAtRevision('1', { status: 'Active' }) },
      })
    })

    await vi.advanceTimersByTimeAsync(4999)
    expect(getAlerts).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getAlerts).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it('uses the post-snapshot watermark before deciding whether an in-flight delta needs another reload', async () => {
    vi.useFakeTimers()
    const reconnectRequest = deferred()
    let streamHandlers
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([alertAtRevision('10')], '10'))
      .mockReturnValueOnce(reconnectRequest.promise)
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    act(() => streamHandlers.onOpen({ isReconnect: true, isRetry: false }))
    expect(getAlerts).toHaveBeenCalledTimes(2)

    act(() => streamHandlers.onEvent({
      type: 'alert.updated',
      payload: { alert: alertAtRevision('12', { title: 'Revision 12' }) },
    }))
    await act(async () => {
      reconnectRequest.resolve(alertSnapshot([alertAtRevision('11')], '11'))
      await reconnectRequest.promise
    })

    await vi.advanceTimersByTimeAsync(10000)
    expect(getAlerts).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    expect(screen.getByText('Revision 12')).toBeInTheDocument()
  })

  it('keeps a snapshot on a buffered revision gap and schedules exactly one trailing repair', async () => {
    vi.useFakeTimers()
    const reconnectRequest = deferred()
    let streamHandlers
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([alertAtRevision('10', { title: 'Revision 10' })], '10'))
      .mockReturnValueOnce(reconnectRequest.promise)
      .mockResolvedValueOnce(alertSnapshot([alertAtRevision('12', { title: 'Revision 12' })], '12'))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    act(() => streamHandlers.onOpen({ isReconnect: true, isRetry: false }))
    act(() => streamHandlers.onEvent({
      type: 'alert.updated',
      payload: { alert: alertAtRevision('12', { title: 'Revision 12' }) },
    }))

    await act(async () => {
      reconnectRequest.resolve(alertSnapshot([alertAtRevision('10', { title: 'Revision 10' })], '10'))
      await reconnectRequest.promise
    })
    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    expect(screen.getByText('Revision 10')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(4999)
    expect(getAlerts).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(getAlerts).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Revision 12')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(10000)
    expect(getAlerts).toHaveBeenCalledTimes(3)
  })

  it('never lets a stale snapshot roll back newer live state and schedules one repair', async () => {
    vi.useFakeTimers()
    const staleRequest = deferred()
    let streamHandlers
    const revision10 = alertAtRevision('10', { title: 'Revision 10' })
    const revision12 = alertAtRevision('12', { title: 'Revision 12' })
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([revision10], '10'))
      .mockReturnValueOnce(staleRequest.promise)
      .mockResolvedValueOnce(alertSnapshot([revision12], '12'))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    act(() => {
      streamHandlers.onEvent({ type: 'alert.updated', payload: { alert: alertAtRevision('11', { title: 'Revision 11' }) } })
      streamHandlers.onEvent({ type: 'alert.updated', payload: { alert: revision12 } })
    })
    await vi.advanceTimersByTimeAsync(5000)
    act(() => streamHandlers.onOpen({ isReconnect: true, isRetry: false }))

    await act(async () => {
      staleRequest.resolve(alertSnapshot([revision10], '10'))
      await staleRequest.promise
    })
    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    expect(screen.getByText('Revision 12')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(4999)
    expect(getAlerts).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(getAlerts).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Revision 12')).toBeInTheDocument()
  })

  it('preserves live state when a slow snapshot exceeds the bounded delta buffer', async () => {
    vi.useFakeTimers()
    const slowRequest = deferred()
    let streamHandlers
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([]))
      .mockReturnValueOnce(slowRequest.promise)
      .mockResolvedValueOnce(alertSnapshot([alertAtRevision('257', { title: 'Revision 257' })], '257'))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    act(() => streamHandlers.onOpen({ isReconnect: true, isRetry: false }))

    act(() => {
      for (let revision = 1; revision <= 257; revision += 1) {
        streamHandlers.onEvent({
          type: 'alert.updated',
          payload: { alert: alertAtRevision(String(revision), { title: `Revision ${revision}` }) },
        })
      }
    })
    await act(async () => {
      slowRequest.resolve(alertSnapshot([]))
      await slowRequest.promise
    })

    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    expect(screen.getByText('Revision 257')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getAlerts).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Revision 257')).toBeInTheDocument()
  })

  it('allows an authoritative same-revision snapshot to replace live-derived rows', async () => {
    vi.useFakeTimers()
    let streamHandlers
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([alertAtRevision('10')], '10'))
      .mockResolvedValueOnce(alertSnapshot([], '12'))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    act(() => {
      streamHandlers.onEvent({ type: 'alert.updated', payload: { alert: alertAtRevision('11') } })
      streamHandlers.onEvent({ type: 'alert.updated', payload: { alert: alertAtRevision('12') } })
    })
    expect(screen.getByRole('button', { name: /open alerts, 1 active/i })).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(5000)
    act(() => streamHandlers.onOpen({ isReconnect: true, isRetry: false }))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
    expect(getAlerts).toHaveBeenCalledTimes(2)
  })

  it('keeps a malformed initial snapshot untrusted and repairs it through one coalesced reload', async () => {
    vi.useFakeTimers()
    getAlerts
      .mockResolvedValueOnce({ alerts: [], snapshotRevision: '01' })
      .mockResolvedValueOnce(alertSnapshot([]))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByRole('button', { name: /open alerts, status unavailable/i })).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(4999)
    expect(getAlerts).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getAlerts).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()
  })

  it('ignores a duplicate acknowledgement revision and repairs an acknowledgement gap', async () => {
    vi.useFakeTimers()
    const active = alertAtRevision('10')
    const acknowledged = alertAtRevision('12', { status: 'Acknowledged' })
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([active], '10'))
      .mockResolvedValueOnce(alertSnapshot([acknowledged], '12'))
    acknowledgeAlert
      .mockResolvedValueOnce({ alert: { ...active, status: 'Acknowledged' } })
      .mockResolvedValueOnce({ alert: acknowledged })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))

    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText('Active')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText('Active')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(4999)
    expect(getAlerts).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(getAlerts).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Acknowledged')).toBeInTheDocument()
  })

  it('rejects an acknowledgement response with an invalid lifecycle status and reloads', async () => {
    vi.useFakeTimers()
    const active = alertAtRevision('10')
    const acknowledged = alertAtRevision('11', { status: 'Acknowledged' })
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([active], '10'))
      .mockResolvedValueOnce(alertSnapshot([acknowledged], '11'))
    acknowledgeAlert.mockResolvedValue({
      alert: alertAtRevision('11', { status: 'Active', title: 'Invalid acknowledgement response' }),
    })

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    fireEvent.click(screen.getByRole('button', { name: /open alerts, 1 active/i }))
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.queryByText('Invalid acknowledgement response')).not.toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5000)
    expect(screen.getByText('Acknowledged')).toBeInTheDocument()
  })

  it('clears queued reloads on unmount and ignores an old token snapshot completion', async () => {
    vi.useFakeTimers()
    const oldRequest = deferred()
    const handlersByToken = new Map()
    getAlerts
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(alertSnapshot([]))
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
    await vi.advanceTimersByTimeAsync(0)
    act(() => handlersByToken.get('first-token').onOpen({ isReconnect: true, isRetry: false }))

    await act(async () => {
      view.rerender(renderTree('second-token'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('button', { name: /open alerts, none active/i })).toBeInTheDocument()

    await act(async () => {
      oldRequest.resolve(alertSnapshot([alertAtRevision('1', { title: 'Old session alert' })]))
      await oldRequest.promise
    })
    await vi.advanceTimersByTimeAsync(10000)

    expect(screen.queryByText('Old session alert')).not.toBeInTheDocument()
    expect(getAlerts).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('cancels a scheduled reconnect reload when the dashboard unmounts', async () => {
    vi.useFakeTimers()
    let streamHandlers
    getAlerts.mockResolvedValue(alertSnapshot([]))
    subscribeToAlerts.mockImplementationOnce((token, handlers) => {
      streamHandlers = handlers
      return vi.fn()
    })

    const view = renderWithAuth(<AdminDashboard />, { route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(0)
    act(() => streamHandlers.onOpen({ isReconnect: true, isRetry: false }))
    view.unmount()

    await vi.advanceTimersByTimeAsync(5000)
    expect(getAlerts).toHaveBeenCalledTimes(1)
  })

  it('ignores stream callbacks from the previous token session', async () => {
    const handlersByToken = new Map()
    getAlerts
      .mockResolvedValueOnce(alertSnapshot([activeAlert()]))
      .mockResolvedValueOnce(alertSnapshot([], '1'))
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
        type: 'alert.created',
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

    getAlerts.mockResolvedValue(alertSnapshot([recoveredAlert]))
    acknowledgeAlert.mockResolvedValue({
      alert: {
        ...recoveredAlert,
        status: 'Resolved',
        acknowledgedAt: '2026-06-11T00:03:00.000Z',
        resolvedAt: '2026-06-11T00:03:00.000Z',
        revision: '2',
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

    getAlerts.mockResolvedValue(alertSnapshot([activeAlert()]))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const bell = await screen.findByRole('button', { name: /open alerts, 1 active/i })
    await user.click(bell)

    expect(screen.getByRole('dialog', { name: /active alerts/i })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /active alerts/i })).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
  })

  it('closes alerts before opening the mobile navigation drawer', async () => {
    const viewport = createControllableMatchMedia(true)
    vi.stubGlobal('matchMedia', viewport.matchMedia)
    const user = userEvent.setup()

    getAlerts.mockResolvedValue(alertSnapshot([activeAlert()]))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: /open alerts, 1 active/i }))
    const openNavigationButton = screen.getByRole('button', { name: /open navigation/i })
    expect(openNavigationButton).not.toHaveClass('sidebar-toggle')
    await user.click(openNavigationButton)

    expect(screen.queryByRole('dialog', { name: /active alerts/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveClass('sidebar-toggle')
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
  })

  it('toggles sidebar collapsed state when clicking the sidebar panel toggle', async () => {
    const user = userEvent.setup()
    getAlerts.mockReturnValue(new Promise(() => {}))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const collapseBtn = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(collapseBtn).toBeInTheDocument()
    expect(collapseBtn).toHaveClass('sidebar-toggle')
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    expect(collapseBtn).toHaveClass('is-pointing-left')

    await user.click(collapseBtn)

    const expandBtn = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expandBtn).toBeInTheDocument()
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
    expect(expandBtn).toHaveClass('is-pointing-right')
    expect(screen.getByRole('complementary')).toHaveClass('is-collapsed')

    await user.click(expandBtn)
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('complementary')).not.toHaveClass('is-collapsed')
  })

  it('keeps the desktop collapse preference while the mobile drawer stays expanded and labeled', async () => {
    const viewport = createControllableMatchMedia(false)
    vi.stubGlobal('matchMedia', viewport.matchMedia)
    const user = userEvent.setup()
    getAlerts.mockReturnValue(new Promise(() => { }))

    renderWithAuth(<AdminDashboard />, { route: '/dashboard' })

    const sidebar = screen.getByRole('complementary')
    const liveFeedLink = screen.getByRole('link', { name: 'Live Feed' })
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(sidebar).toHaveClass('is-collapsed')
    expect(liveFeedLink).toHaveAttribute('title', 'Live Feed')
    expect(liveFeedLink).toHaveAttribute('aria-label', 'Live Feed')

    act(() => viewport.setMatches(true))

    await waitFor(() => expect(sidebar).not.toHaveClass('is-collapsed'))
    expect(liveFeedLink).not.toHaveAttribute('title')
    expect(liveFeedLink).not.toHaveAttribute('aria-label')

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))

    expect(sidebar).toHaveClass('is-open')
    expect(sidebar).not.toHaveClass('is-collapsed')
    expect(screen.getByRole('link', { name: 'Live Feed' })).toHaveTextContent('Live Feed')
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()

    act(() => viewport.setMatches(false))

    await waitFor(() => {
      expect(sidebar).toHaveClass('is-collapsed')
      expect(sidebar).not.toHaveClass('is-open')
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveFocus()
    })
    expect(liveFeedLink).toHaveAttribute('title', 'Live Feed')
    expect(liveFeedLink).toHaveAttribute('aria-label', 'Live Feed')
  })
})
