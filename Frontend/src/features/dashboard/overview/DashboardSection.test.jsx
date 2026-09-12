import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { AuthContext } from '../../auth/authSession.jsx'
import DashboardSection from './DashboardSection.jsx'
import { getDashboardDowntimeImpact, getDashboardOverview } from './dashboardService.js'
import { getLiveFeed } from '../live/liveService.js'
import '../../../shared/components/ui/Calendar.jsx'

vi.mock('./dashboardService.js', () => ({
  getDashboardOverview: vi.fn(),
  getDashboardDowntimeImpact: vi.fn(),
}))

vi.mock('../live/liveService.js', () => ({
  getLiveFeed: vi.fn(),
}))

vi.mock('./ProductionAnalytics.jsx', () => ({
  default: () => <section aria-label="Production analytics">Production analytics loaded</section>,
}))

vi.mock('./DowntimeTrendChart.jsx', async () => {
  const actual = await vi.importActual('./DowntimeTrendChart.jsx')

  return {
    ...actual,
    default: ({ data }) => (
      <div data-testid="downtime-chart">
        Downtime points: {data.length} ({data.map((point) => point.label).join(', ')})
      </div>
    ),
  }
})

function overviewPayload() {
  return {
    alerts: [],
    summary: [{ id: 'pipes', label: 'Production Output', value: '5 pcs', helper: 'Today' }],
    productionAnalytics: {
      day: {
        currentTotal: 5,
        previousTotal: 3,
        difference: 2,
        differencePercent: 66.67,
        unit: 'pcs',
        currentLabel: 'Today',
        previousLabel: 'Yesterday',
        label: 'Today vs Yesterday',
      },
    },
    availability: [{ machineId: 'Spiral Mill 01', percent: 98 }],
  }
}

function livePayload() {
  return {
    machine: {
      id: 'machine-1',
      machineCode: 'M-01',
      name: 'Spiral Mill 01',
      status: 'Running',
    },
    sensors: [
      { id: 'sensor-1', sensorCode: 'S-01', status: 'Running', lastEventAt: '2026-07-23T02:00:00.000Z' },
      { id: 'sensor-2', sensorCode: 'S-02', status: 'Running', lastEventAt: '2026-07-23T02:01:00.000Z' },
      { id: 'sensor-3', sensorCode: 'S-03', status: 'Idle', lastEventAt: '2026-07-23T02:02:00.000Z' },
      { id: 'sensor-4', sensorCode: 'S-04', status: 'Running', lastEventAt: '2026-07-23T02:03:00.000Z' },
      { id: 'sensor-5', sensorCode: 'S-05', status: 'Running', lastEventAt: '2026-07-23T02:04:00.000Z' },
    ],
  }
}

function emptyDowntimePayload() {
  return { downtimeImpact: { thresholdMinutes: 30, points: [] } }
}

function deferred() {
  let reject
  let resolve
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function RealtimeAlertHarness() {
  const [activeAlerts, setActiveAlerts] = useState([])

  return (
    <>
      <button
        type="button"
        onClick={() => setActiveAlerts([{
          id: 'alert-1',
          severity: 'Critical',
          status: 'Active',
          message: 'S-04 Outside Filler Wire has no pulse.',
        }])}
      >
        Emit alert
      </button>
      <Outlet context={{ activeAlerts, hasTrustedAlertList: true }} />
    </>
  )
}

function MixedAlertHarness() {
  return (
    <Outlet context={{
      hasTrustedAlertList: true,
      activeAlerts: [
        {
          id: 'recovered-group-alert',
          severity: 'Critical',
          status: 'Active',
          message: 'S-01, S-02, and S-04 remained faulted; machine downtime confirmed.',
          metadata: { recoveryPending: true },
        },
        {
          id: 'active-process-alert',
          severity: 'Warning',
          status: 'Active',
          message: 'S-04 reported an explicit physical fault.',
        },
      ],
    }} />
  )
}

function AlertDestinationHarness({ activeAlerts }) {
  return <Outlet context={{ activeAlerts, hasTrustedAlertList: true }} />
}

function AcknowledgedFaultHarness() {
  return (
    <Outlet context={{
      activeAlerts: [],
      hasTrustedAlertList: true,
      unresolvedAlerts: [{
        id: 'acknowledged-process-fault',
        severity: 'Warning',
        status: 'Acknowledged',
        message: 'S-01 reported an explicit physical fault.',
        metadata: { processFault: true },
      }],
    }} />
  )
}

describe('DashboardSection', () => {
  it('F03 refreshes live sensor state on the overview cadence', async () => {
    const timer = vi.spyOn(window, 'setInterval')
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(livePayload())
    const view = renderWithAuth(<DashboardSection />)
    await screen.findByText('Production Output')
    const next = livePayload()
    next.machine.status = 'Downtime'
    getLiveFeed.mockResolvedValue(next)
    await act(async () => { timer.mock.calls.find(([, delay]) => delay === 60000)[0]() })
    expect(await screen.findByText('Downtime')).toBeInTheDocument()
    expect(getLiveFeed).toHaveBeenCalledTimes(2)
    expect(getDashboardDowntimeImpact).toHaveBeenCalledTimes(2)
    view.unmount()
    timer.mockRestore()
  })
  beforeEach(() => {
    getDashboardOverview.mockReset()
    getDashboardDowntimeImpact.mockReset()
    getLiveFeed.mockReset()
  })

  it('shows a trusted realtime alert without refetching the overview', async () => {
    const user = userEvent.setup()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(
      <Routes>
        <Route element={<RealtimeAlertHarness />}>
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    expect(screen.queryByText('S-04 Outside Filler Wire has no pulse.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Emit alert' }))

    expect(screen.getByRole('alert')).toHaveTextContent('S-04 Outside Filler Wire has no pulse.')
    expect(getDashboardOverview).toHaveBeenCalledTimes(1)
  })

  it('prioritizes a current fault over a recovered alert awaiting acknowledgement', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(
      <Routes>
        <Route element={<MixedAlertHarness />}>
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('S-04 reported an explicit physical fault.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('machine downtime confirmed')
  })

  it('keeps an acknowledged unresolved fault banner visible and red after reload', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(
      <Routes>
        <Route element={<AcknowledgedFaultHarness />}>
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('S-01 reported an explicit physical fault.')
    expect(banner).toHaveClass('notice-error')
  })

  it('F09 links process faults and downtime alerts to their matching records', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(
      <Routes>
        <Route element={<AlertDestinationHarness activeAlerts={[
          { id: 'process-fault', severity: 'Warning', status: 'Active', message: 'S-01 reported a physical fault.', metadata: { processFault: true, downtimeId: 'legacy-downtime-1' } },
          { id: 'downtime', severity: 'Critical', status: 'Active', message: 'Machine downtime confirmed.', metadata: { downtimeId: 'downtime-1' } },
        ]} />}>
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    expect(await screen.findByRole('link', { name: 'View live sensor status' })).toHaveAttribute('href', '/dashboard/live')
    expect(screen.getByRole('link', { name: 'View downtime records' })).toHaveAttribute('href', '/dashboard/downtime')
  })

  it('renders a fault live sensor with fault styling and icon', async () => {
    const live = livePayload()
    live.sensors[0].status = 'Fault'
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(live)

    renderWithAuth(<DashboardSection />)

    const badge = await screen.findByText('Fault')
    const card = badge.closest('article')
    expect(badge).toHaveClass('status-downtime')
    expect(card).toHaveClass('status-downtime')
    expect(card.querySelector('svg.lucide-wrench')).not.toBeNull()
  })

  it('refreshes production bucket states while the page remains open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    try {
      renderWithAuth(<DashboardSection />)
      expect(await screen.findByText('Production Output')).toBeInTheDocument()
      expect(getDashboardOverview).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(60 * 1000)
      await waitFor(() => expect(getDashboardOverview).toHaveBeenCalledTimes(2))
      expect(screen.getByLabelText('Production analytics')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reloads only the downtime chart when chart range changes', async () => {
    const user = userEvent.setup()

    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Mon', minutes: 10 }] } })
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: '6 AM', minutes: 4 }] } })

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    expect(await screen.findByTestId('downtime-chart')).toHaveTextContent('Downtime points: 1')
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText('Difference from Yesterday')).toBeInTheDocument()
    expect(screen.getByText('+2 pcs')).toBeInTheDocument()
    expect(screen.getByText('5 / 5 sensors reporting')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /last hour/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /weekly/i }))

    await waitFor(() => {
      expect(getDashboardDowntimeImpact).toHaveBeenCalledTimes(2)
    })
    expect(getDashboardOverview).toHaveBeenCalledTimes(1)
    expect(getLiveFeed).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Production Output')).toBeInTheDocument()
  })

  it('keeps weekly and monthly request parameters unchanged after calendar selection', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 20, 12))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue({
      downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Mon', minutes: 10 }] },
    })

    try {
      renderWithAuth(<DashboardSection />)
      expect(await screen.findByText('Production Output')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Weekly' }))
      await user.click(screen.getByRole('button', { name: /selected period/i }))
      await user.click(await screen.findByRole('button', { name: /july 14th, 2026/i }))

      await waitFor(() => {
        expect(getDashboardDowntimeImpact).toHaveBeenLastCalledWith(
          'test-token',
          { trendMode: 'week', date: '2026-07-14' },
        )
      })

      await user.click(screen.getByRole('button', { name: 'Monthly' }))
      await user.click(screen.getByRole('button', { name: /selected period/i }))
      await user.click(await screen.findByRole('button', { name: /july 8th, 2026/i }))

      await waitFor(() => {
        expect(getDashboardDowntimeImpact).toHaveBeenLastCalledWith(
          'test-token',
          { trendMode: 'month', date: '2026-07' },
        )
      })
    } finally {
      vi.useRealTimers()
    }
  }, 15000)

  it('shows an overview-specific error and retries without calling the failure empty data', async () => {
    const user = userEvent.setup()
    getDashboardOverview
      .mockRejectedValueOnce(new Error('Overview service failed.'))
      .mockResolvedValueOnce(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByRole('heading', { name: 'Unable to load dashboard overview' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Overview service failed.')
    expect(screen.queryByRole('heading', { name: 'No overview data available' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry overview' }))

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    expect(getDashboardOverview).toHaveBeenCalledTimes(2)
  })

  it('renders a live-source failure instead of unavailable sensor statuses', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockRejectedValue(new Error('Live source failed.'))
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByRole('heading', { name: 'Unable to load live machine status' })).toBeInTheDocument()
    expect(screen.getByText('Live source failed.')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Retry live status' })).toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Five inductive proximity sensor statuses')).not.toBeInTheDocument()
  })

  it('renders a valid empty live-source result without inventing sensor faults', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue({ machine: null, sensors: [] })
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByRole('heading', { name: 'No live machine is available' })).toBeInTheDocument()
    expect(screen.getByText(/last successful live-status request/i)).toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Five inductive proximity sensor statuses')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unable to load live machine status' })).not.toBeInTheDocument()
  })

  it('keeps a successful empty live result visible when its refresh fails', async () => {
    const user = userEvent.setup()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed
      .mockResolvedValueOnce({ machine: null, sensors: [] })
      .mockRejectedValueOnce(new Error('Empty live refresh failed.'))
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByRole('heading', { name: 'No live machine is available' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /refresh overview data/i }))

    expect(await screen.findByText(/last successful empty result/i)).toHaveTextContent('Empty live refresh failed.')
    expect(screen.getByRole('heading', { name: 'No live machine is available' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry live status' })).toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Five inductive proximity sensor statuses')).not.toBeInTheDocument()
  })

  it('preserves the same-token live result as visibly stale after refresh failure', async () => {
    const user = userEvent.setup()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed
      .mockResolvedValueOnce(livePayload())
      .mockRejectedValueOnce(new Error('Live refresh failed.'))
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('5 / 5 reporting')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /refresh overview data/i }))

    const staleNotice = await screen.findByText(/Live machine status is stale/i)
    expect(staleNotice).toHaveTextContent('Live refresh failed.')
    expect(staleNotice.querySelector('time')).toHaveAttribute('dateTime')
    expect(screen.getByText('5 / 5 reporting')).toBeInTheDocument()
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
  })

  it('distinguishes chart error from empty and retries the current range', async () => {
    const user = userEvent.setup()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact
      .mockRejectedValueOnce(new Error('Chart service failed.'))
      .mockResolvedValueOnce(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Chart service failed.')).toBeInTheDocument()
    expect(screen.queryByText('No downtime data is available for this range.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry chart' }))

    expect(await screen.findByText('No downtime data is available for this range.')).toBeInTheDocument()
    expect(screen.queryByText('Chart service failed.')).not.toBeInTheDocument()
  })

  it('treats a successful null downtime impact as a valid empty chart', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue({ downtimeImpact: null })

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('No downtime data is available for this range.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry chart' })).not.toBeInTheDocument()
  })

  it('keeps a cached null chart visibly empty when its refresh fails', async () => {
    const user = userEvent.setup()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact
      .mockResolvedValueOnce({ downtimeImpact: null })
      .mockRejectedValueOnce(new Error('Empty chart refresh failed.'))

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('No downtime data is available for this range.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /refresh overview data/i }))

    expect(await screen.findByText(/Downtime chart data is stale/i)).toHaveTextContent('Empty chart refresh failed.')
    expect(screen.getByText('No downtime data is available for this range.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry chart' })).toBeInTheDocument()
  })

  it('announces initial overview and chart loading regions once per source', () => {
    getDashboardOverview.mockReturnValue(new Promise(() => {}))
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockReturnValue(new Promise(() => {}))

    renderWithAuth(<DashboardSection />)

    const overviewLoading = screen.getByText('Loading dashboard overview...')
    const chartLoading = screen.getByText('Loading downtime chart...')
    expect(overviewLoading.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite')
    expect(chartLoading.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getAllByText('Loading dashboard overview...')).toHaveLength(1)
    expect(screen.getAllByText('Loading downtime chart...')).toHaveLength(1)
  })

  it('hides prior-token live metadata and errors while the new token loads', async () => {
    const user = userEvent.setup()
    const nextTokenLiveRequest = deferred()
    const priorTokenLive = livePayload()
    priorTokenLive.machine = { ...priorTokenLive.machine, name: 'Prior token machine' }
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed
      .mockResolvedValueOnce(priorTokenLive)
      .mockRejectedValueOnce(new Error('Prior token refresh failed.'))
      .mockReturnValueOnce(nextTokenLiveRequest.promise)

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter>
            <DashboardSection />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))
    expect(await screen.findByRole('heading', { name: 'Prior token machine' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /refresh overview data/i }))
    expect(await screen.findByText(/Live machine status is stale/i)).toHaveTextContent('Prior token refresh failed.')

    const staleMachineKpi = screen.getByText('Machine Online').closest('article')
    expect(staleMachineKpi).toHaveTextContent('Stale')
    expect(staleMachineKpi).not.toHaveTextContent('1 / 1')

    view.rerender(renderTree('second-token'))

    await waitFor(() => {
      expect(screen.queryByText('Prior token machine')).not.toBeInTheDocument()
      expect(screen.queryByText(/Prior token refresh failed/i)).not.toBeInTheDocument()
      expect(screen.getByText('Machine Online')).toBeInTheDocument()
    })
    const loadingMachineKpi = screen.getByText('Machine Online').closest('article')
    expect(loadingMachineKpi).toHaveTextContent('Refreshing live status')
    expect(loadingMachineKpi).not.toHaveTextContent('1 / 1')
  })

  it('hides previous chart points while a different range loads and fails', async () => {
    const user = userEvent.setup()
    const weeklyRequest = deferred()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Old daily point', minutes: 10 }] } })
      .mockReturnValueOnce(weeklyRequest.promise)
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Cached daily point', minutes: 10 }] } })

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText(/Old daily point/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.queryByText(/Old daily point/)).not.toBeInTheDocument()

    weeklyRequest.reject(new Error('Weekly range failed.'))

    expect(await screen.findByText('Weekly range failed.')).toBeInTheDocument()
    expect(screen.queryByText(/Old daily point/)).not.toBeInTheDocument()
    expect(screen.queryByText('No downtime data is available for this range.')).not.toBeInTheDocument()
  })

  it('does not show a different-range chart error when returning to cached points', async () => {
    const user = userEvent.setup()
    const returnedDailyRequest = deferred()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Cached daily point', minutes: 10 }] } })
      .mockRejectedValueOnce(new Error('Weekly range failed.'))
      .mockReturnValueOnce(returnedDailyRequest.promise)

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText(/Cached daily point/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(await screen.findByText('Weekly range failed.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Daily' }))

    expect(screen.queryByText('Weekly range failed.')).not.toBeInTheDocument()
    expect(screen.getByText(/Cached daily point/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing downtime chart...')
  })

  it('announces a same-range chart refresh while preserving cached points', async () => {
    const user = userEvent.setup()
    const refreshRequest = deferred()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Cached chart point', minutes: 10 }] } })
      .mockReturnValueOnce(refreshRequest.promise)

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText(/Cached chart point/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /refresh overview data/i }))

    expect(screen.getByText(/Cached chart point/)).toBeInTheDocument()
    const refreshStatus = screen.getByText('Refreshing downtime chart...')
    expect(refreshStatus).toHaveAttribute('role', 'status')
    expect(refreshStatus).toHaveAttribute('aria-live', 'polite')
  })
})
