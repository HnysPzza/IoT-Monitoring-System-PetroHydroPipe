import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { useState } from 'react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { AuthContext } from '../../auth/authSession.jsx'
import DashboardSection from './DashboardSection.jsx'
import { sensorIdentities } from '../../../shared/constants/sensorIdentity.js'
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

function overviewPayload(overrides = {}) {
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
        points: [
          { label: '6AM', current: 5, previous: 3, periodState: 'current' },
        ],
      },
    },
    availability: [{ machineId: 'Spiral Mill 01', percent: 98 }],
    ...overrides,
  }
}

function livePayload(overrides = {}) {
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
    ...overrides,
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
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('S-04 reported an explicit physical fault.')
    expect(banner).not.toHaveTextContent('machine downtime confirmed')
    expect(banner).toHaveClass('notice-error')
  })

  it('keeps the red notice-error banner when multiple unresolved connectivity or fault alerts are present', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(
      <Routes>
        <Route
          element={(
            <Outlet
              context={{
                hasTrustedAlertList: true,
                unresolvedAlerts: [
                  {
                    id: 'connectivity-1',
                    severity: 'Warning',
                    status: 'Acknowledged',
                    sourceType: 'sensor_connectivity',
                    message: 'S-03 heartbeat is stale.',
                    metadata: { sensorCode: 'S-03', machineCode: 'M-01' },
                  },
                  {
                    id: 'connectivity-2',
                    severity: 'Warning',
                    status: 'Acknowledged',
                    sourceType: 'sensor_connectivity',
                    message: 'S-05 heartbeat is stale.',
                    metadata: { sensorCode: 'S-05', machineCode: 'M-01' },
                  },
                  {
                    id: 'connectivity-3',
                    severity: 'Warning',
                    status: 'Acknowledged',
                    sourceType: 'sensor_connectivity',
                    message: 'S-02 heartbeat is stale.',
                    metadata: { sensorCode: 'S-02', machineCode: 'M-01' },
                  },
                ],
              }}
            />
          )}
        >
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('S-03 heartbeat is stale.')
    expect(banner).toHaveTextContent('+2 more unresolved alerts')
    expect(banner).toHaveClass('notice-error')
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

  it('renders a fault live sensor with an amber fault status', async () => {
    const live = livePayload()
    live.sensors[0].status = 'Fault'
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(live)

    renderWithAuth(<DashboardSection />)

    const badge = await screen.findByText('Fault')
    const card = badge.closest('article')
    expect(badge).toHaveClass('status-fault')
    expect(badge).not.toHaveClass('status-danger')
    expect(card).toHaveClass('status-fault')
    expect(badge.firstChild).toHaveClass('status-dot-fault')
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
    await user.click(screen.getByRole('button', { name: /selected period/i }))
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

      await user.click(screen.getByRole('button', { name: /selected period/i }))
      await user.click(screen.getByRole('button', { name: 'Weekly' }))
      const weekButton = await screen.findByRole('button', { name: /select week jul 6, 2026 - jul 12, 2026/i })
      const callsBeforeWeekApply = getDashboardDowntimeImpact.mock.calls.length
      await user.click(weekButton)
      expect(getDashboardDowntimeImpact).toHaveBeenCalledTimes(callsBeforeWeekApply)
      await user.click(screen.getByRole('button', { name: 'Apply' }))

      await waitFor(() => {
        expect(getDashboardDowntimeImpact).toHaveBeenLastCalledWith(
          'test-token',
          { trendMode: 'week', date: '2026-07-06' },
          { signal: expect.any(AbortSignal) },
        )
      })

      await user.click(screen.getByRole('button', { name: /selected period/i }))
      await user.click(screen.getByRole('button', { name: 'Monthly' }))
      const callsBeforeMonthApply = getDashboardDowntimeImpact.mock.calls.length
      await user.click(screen.getByRole('button', { name: 'Jun 2026' }))
      expect(getDashboardDowntimeImpact).toHaveBeenCalledTimes(callsBeforeMonthApply)
      await user.click(screen.getByRole('button', { name: 'Apply' }))

      await waitFor(() => {
        expect(getDashboardDowntimeImpact).toHaveBeenLastCalledWith(
          'test-token',
          { trendMode: 'month', date: '2026-06' },
          { signal: expect.any(AbortSignal) },
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

  it('marks Overview machine health stale immediately when offline', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    renderWithAuth(<DashboardSection />)
    await screen.findByRole('heading', { name: 'Machine Health · Spiral Mill 01' })
    act(() => onlineManager.setOnline(false))
    expect(screen.getByText(/Live machine status is stale/i)).toHaveTextContent(/updated.*ago/i)
    await act(async () => { onlineManager.setOnline(true); await Promise.resolve() })
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

  it('renders an Overview heading, mobile machine summary at mobile width, and computed KPI helper subtitles', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(livePayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(max-width: 900px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    try {
      renderWithAuth(<DashboardSection />)

      const heading = await screen.findByRole('heading', { level: 1, name: /overview/i })
      expect(heading).toHaveClass('sr-only')
      expect(document.querySelector('.overview-mobile-meta')).toHaveTextContent(/Spiral Mill 01.*5 \/ 5 reporting/i)

      const kpiHelpers = document.querySelectorAll('.kpi-grid .stat-card .stat-helper')
      expect(kpiHelpers).toHaveLength(4)
    } finally {
      window.matchMedia = originalMatchMedia
    }
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
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
        <QueryClientProvider client={client}><AuthContext.Provider value={{ token, isAuthenticated: true, user: { id: 'one', role: 'Admin' } }}>
          <MemoryRouter>
            <DashboardSection />
          </MemoryRouter>
        </AuthContext.Provider></QueryClientProvider>
      )
    }

    const view = render(renderTree('first-token'))
    expect(await screen.findByRole('heading', { name: 'Machine Health · Prior token machine' })).toBeInTheDocument()
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
    expect(loadingMachineKpi).toHaveTextContent('—')
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
    await user.click(screen.getByRole('button', { name: /selected period/i }))
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
    await user.click(screen.getByRole('button', { name: /selected period/i }))
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(await screen.findByText('Weekly range failed.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Daily' }))

    expect(screen.queryByText('Weekly range failed.')).not.toBeInTheDocument()
    expect(screen.getByText(/Cached daily point/)).toBeInTheDocument()
    expect(getDashboardDowntimeImpact).toHaveBeenCalledTimes(2)
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

  it('stacks the fault alert banner and the idle material changeover banner when one sensor has an alert and another is idle', async () => {
    const user = userEvent.setup()
    const liveWithIdleS01 = livePayload()
    liveWithIdleS01.sensors[0].status = 'Idle'
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(liveWithIdleS01)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(
      <Routes>
        <Route element={<RealtimeAlertHarness />}>
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    const idleBannerText = await screen.findByText(
      'S-01 Raw Material & Coil Joint is idle.',
    )
    const idleBanner = idleBannerText.closest('.overview-alert-banner')
    expect(idleBanner).toHaveClass('notice-idle')
    expect(idleBanner).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Emit alert' }))

    expect(screen.getByRole('alert')).toHaveTextContent('S-04 Outside Filler Wire has no pulse.')
    expect(
      screen.getByText('S-01 Raw Material & Coil Joint is idle.'),
    ).toBeInTheDocument()
  })

  it('expands the additional idle sensors', async () => {
    const user = userEvent.setup()
    const live = livePayload()
    live.sensors[0].status = 'Idle'
    live.sensors[1].status = 'Idle'
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(live)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)
    const trigger = await screen.findByText('+1 more idle sensor')
    expect(trigger.closest('details')).not.toHaveAttribute('open')
    await user.click(trigger)
    expect(trigger.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('S-02 Inside Filler Wire')).toBeVisible()
  })

  it('replaces the idle banner on overview when that idle sensor transitions to Fault', async () => {
    const user = userEvent.setup()
    const liveWithIdleS01 = livePayload()
    liveWithIdleS01.sensors[0].status = 'Idle'
    const liveWithFaultS01 = livePayload()
    liveWithFaultS01.sensors[0].status = 'Fault'

    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValueOnce(liveWithIdleS01).mockResolvedValueOnce(liveWithFaultS01)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(<DashboardSection />)

    expect(
      await screen.findByText('S-01 Raw Material & Coil Joint is idle.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /refresh overview data/i }))

    expect(
      await screen.findByText('S-01 Raw Material & Coil Joint process issue detected — trigger limit exceeded.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('S-01 Raw Material & Coil Joint is idle.'),
    ).not.toBeInTheDocument()
  })

  it('stacks the recoveryPending alert banner and the idle banner on overview when a process sensor is idle', async () => {
    const liveWithIdleS01 = livePayload()
    liveWithIdleS01.sensors[0].status = 'Idle'
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getLiveFeed.mockResolvedValue(liveWithIdleS01)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())

    renderWithAuth(
      <Routes>
        <Route
          element={(
            <Outlet
              context={{
                hasTrustedAlertList: true,
                unresolvedAlerts: [{
                  id: 'recovered-alert-1',
                  severity: 'Critical',
                  status: 'Active',
                  message: 'S-03 machine authority reported a physical fault.',
                  metadata: { recoveryPending: true },
                }],
              }}
            />
          )}
        >
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    expect(
      await screen.findByText('S-01 Raw Material & Coil Joint is idle.'),
    ).toBeInTheDocument()
    expect(screen.getByText('This alert recovered. Acknowledgement required.')).toBeInTheDocument()
  })

  it('normalizes an offline running sensor to Last: Run and excludes it from reporting counts on overview', async () => {
    const live = livePayload()
    live.sensors[0] = {
      ...live.sensors[0],
      status: 'Running',
      monitoring: { stateFresh: true, connectivityState: 'offline', detectionState: 'suspended' },
    }
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(live)

    renderWithAuth(<DashboardSection />)

    const offlineBadge = await screen.findByText('Last: Run')
    const card = offlineBadge.closest('article')
    expect(offlineBadge).toHaveClass('status', 'status-offline')
    expect(offlineBadge.firstChild).toHaveClass('status-dot-offline')
    expect(card).toHaveClass('status-offline')
    expect(card).not.toHaveClass('status-running')
    expect(card).toHaveTextContent('Connection: Offline')
    expect(screen.getByText('4 / 5 sensors reporting')).toBeInTheDocument()
  })

  it('keeps canonical sensorIdentity labels even when live sensor payload sends an alias label', async () => {
    const live = livePayload()
    live.sensors = live.sensors.map((sensor) => (
      sensor.sensorCode === 'S-05'
        ? { ...sensor, label: 'Finished Pipe Output' }
        : sensor
    ))
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(live)

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Production Output Cutting' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Finished Pipe Output' })).not.toBeInTheDocument()
  })

  it('shows Machine Online as 0 / 1 when machine status is Downtime or all sensors are offline, and keeps 0 min downtime neutral', async () => {
    const downtimeLive = livePayload()
    downtimeLive.machine.status = 'Downtime'
    const zeroDowntimeOverview = overviewPayload()
    zeroDowntimeOverview.summary = [
      ...zeroDowntimeOverview.summary,
      { id: 'minutes', label: 'Downtime', value: '0 min', helper: '0 unplanned min' },
    ]
    getDashboardOverview.mockResolvedValue(zeroDowntimeOverview)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(downtimeLive)

    const { unmount } = renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Spiral Mill 01 · Downtime')).toBeInTheDocument()
    const machineCard = screen.getByText('Machine Online').closest('article')
    expect(machineCard).toHaveTextContent('0 / 1')
    expect(machineCard).toHaveClass('stat-card-warning')

    expect(await screen.findByText('0 unplanned min')).toBeInTheDocument()
    const downtimeCard = screen.getByText('Downtime').closest('article')
    expect(downtimeCard).toHaveTextContent('0 min')
    expect(downtimeCard).toHaveClass('stat-card-neutral')
    expect(downtimeCard).not.toHaveClass('stat-card-warning')

    unmount()

    const offlineSensorsLive = livePayload()
    offlineSensorsLive.machine.status = 'Running'
    offlineSensorsLive.sensors = offlineSensorsLive.sensors.map((sensor) => ({
      ...sensor,
      status: 'Offline',
      monitoring: { connectivityState: 'offline' },
    }))
    const nonZeroOverview = overviewPayload()
    nonZeroOverview.summary = [
      ...nonZeroOverview.summary,
      { id: 'minutes', label: 'Downtime', value: '18 min', helper: '18 unplanned min' },
    ]
    getDashboardOverview.mockResolvedValue(nonZeroOverview)
    getLiveFeed.mockResolvedValue(offlineSensorsLive)

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Spiral Mill 01 · Sensors offline')).toBeInTheDocument()
    const offlineMachineCard = screen.getByText('Machine Online').closest('article')
    expect(offlineMachineCard).toHaveTextContent('0 / 1')
    expect(offlineMachineCard).toHaveClass('stat-card-warning')

    expect(await screen.findByText('18 min')).toBeInTheDocument()
    const nonZeroDowntimeCard = screen.getByText('Downtime').closest('article')
    expect(nonZeroDowntimeCard).toHaveClass('stat-card-warning')
  })

  it('links each sensor card to Live Feed and shows relative event age when timestamp exists', async () => {
    const live = livePayload()
    live.sensors = live.sensors.map((sensor) => (
      sensor.sensorCode === 'S-05'
        ? { ...sensor, lastEventAt: null }
        : { ...sensor, lastEventAt: new Date(Date.now() - 120_000).toISOString() }
    ))
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(live)

    renderWithAuth(<DashboardSection />)

    const s05Heading = await screen.findByRole('heading', { level: 3, name: 'Production Output Cutting' })
    const s05Link = s05Heading.querySelector('a')
    expect(s05Link).toHaveAttribute('href', '/dashboard/live')
    expect(s05Heading.closest('article')).toHaveTextContent('No recent event')

    const s01Card = screen.getByRole('heading', { level: 3, name: sensorIdentities[0].label }).closest('article')
    expect(s01Card).toHaveTextContent(/ago/i)
    expect(s01Card.querySelector('a')).toHaveAttribute('href', '/dashboard/live')
  })

  it('reports partial sync and coordinates live-region politeness when overview or chart sources degrade', async () => {
    getDashboardOverview.mockRejectedValue(new Error('Overview outage'))
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(livePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Unable to load dashboard overview')).toBeInTheDocument()
    const syncBadge = screen.getByText(/Partial sync/i).closest('.overview-meta-item')
    expect(syncBadge).toHaveClass('is-partial')
    expect(syncBadge).toHaveAttribute('title', expect.stringContaining('Overview: Unavailable'))
    expect(syncBadge).toHaveAttribute('title', expect.stringContaining('Live feed:'))
  })

  it('suppresses competing live announcements when primary fault and multiple stale panels coexist', async () => {
    const user = userEvent.setup()
    const idleAndFaultLive = livePayload()
    idleAndFaultLive.sensors[0].status = 'Idle'
    getDashboardOverview.mockResolvedValueOnce(overviewPayload()).mockRejectedValue(new Error('Overview refresh failed'))
    getDashboardDowntimeImpact.mockResolvedValueOnce(emptyDowntimePayload()).mockRejectedValue(new Error('Chart refresh failed'))
    getLiveFeed.mockResolvedValueOnce(idleAndFaultLive).mockRejectedValue(new Error('Live refresh failed'))

    renderWithAuth(
      <Routes>
        <Route element={<RealtimeAlertHarness />}>
          <Route index element={<DashboardSection />} />
        </Route>
      </Routes>,
    )

    const idleBannerText = await screen.findByText('S-01 Raw Material & Coil Joint is idle.')
    const idleBanner = idleBannerText.closest('[role="status"]')

    await user.click(screen.getByRole('button', { name: 'Emit alert' }))

    expect(idleBanner).toHaveAttribute('aria-live', 'off')

    await user.click(screen.getByRole('button', { name: 'Refresh overview data' }))

    const overviewStale = (await screen.findByText(/Overview data is stale/i)).closest('[role="status"]')
    const chartStale = screen.getByText(/Downtime chart data is stale/i).closest('[role="status"]')
    const liveStale = screen.getByText(/Live machine status is stale/i).closest('[role="status"]')

    expect(overviewStale).toHaveAttribute('aria-live', 'polite')
    expect(chartStale).toHaveAttribute('aria-live', 'off')
    expect(liveStale).toHaveAttribute('aria-live', 'off')
  })

  it('opens an accessible sync breakdown popover via keyboard/click and suppresses concurrent chart refresh aria-live while overview is stale', async () => {
    const user = userEvent.setup()
    let rejectOverviewRefresh
    let holdChartRefresh = true
    let resolveChartRefresh
    getDashboardOverview
      .mockResolvedValueOnce(overviewPayload({ alerts: [] }))
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectOverviewRefresh = reject
      }))
    getDashboardDowntimeImpact
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Mon', minutes: 10 }] } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        if (!holdChartRefresh) resolve({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Mon', minutes: 10 }] } })
        else resolveChartRefresh = resolve
      }))
    getLiveFeed.mockResolvedValue(livePayload({
      sensors: [
        { id: 'S-01', sensorCode: 'S-01', label: 'Raw Material & Coil Joint', status: 'Running', lastEventAt: new Date(Date.now() + 5000).toISOString() },
        { id: 'S-02', sensorCode: 'S-02', label: 'Inside Filler Wire', status: 'Offline', lastEventAt: new Date(Date.now() - 120_000).toISOString() },
      ],
    }))

    renderWithAuth(<DashboardSection />)

    const syncTrigger = await screen.findByRole('button', { name: /sync status:/i })
    expect(syncTrigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(syncTrigger)
    expect(syncTrigger).toHaveAttribute('aria-expanded', 'true')
    const breakdown = screen.getByRole('region', { name: 'Sync source breakdown' })
    expect(breakdown).toHaveTextContent(/Overview:/i)
    expect(breakdown).toHaveTextContent(/Downtime chart:/i)
    expect(breakdown).toHaveTextContent(/Live feed:/i)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Sync source breakdown' })).not.toBeInTheDocument()
    expect(syncTrigger).toHaveAttribute('aria-expanded', 'false')

    const s01Card = screen.getByRole('heading', { level: 3, name: 'Raw Material & Coil Joint' }).closest('article')
    expect(s01Card).toHaveTextContent(/·\s*now/i)
    expect(screen.queryByText(/in \d+ seconds/i)).not.toBeInTheDocument()

    const offlineStatus = screen.getByText('Offline', { selector: '.status' })
    expect(offlineStatus).toHaveClass('status-offline')
    expect(offlineStatus.closest('article')).toHaveClass('status-offline')

    await user.click(screen.getByRole('button', { name: 'Refresh overview data' }))
    rejectOverviewRefresh(new Error('Overview refresh failed'))

    const overviewStale = (await screen.findByText(/Overview data is stale/i)).closest('[role="status"]')
    const retryOverviewButton = screen.getByRole('button', { name: /retry overview/i })
    expect(retryOverviewButton).toHaveClass('btn', 'btn-secondary', 'overview-retry-button')

    const chartRefreshing = screen.getByText('Refreshing downtime chart...').closest('[role="status"]')
    expect(overviewStale).toHaveAttribute('aria-live', 'polite')
    expect(chartRefreshing).toHaveAttribute('aria-live', 'off')

    holdChartRefresh = false
    resolveChartRefresh({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Mon', minutes: 10 }] } })
  })

  it('guards missing productionAnalytics points without crashing and removes shadowed h3 title attribute', async () => {
    const partialAnalytics = overviewPayload({
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
    })
    getDashboardOverview.mockResolvedValue(partialAnalytics)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(livePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    expect(screen.queryByLabelText('Production analytics')).not.toBeInTheDocument()
    const sensorHeading = screen.getByRole('heading', { level: 3, name: 'Raw Material & Coil Joint' })
    expect(sensorHeading).not.toHaveAttribute('title')
  })

  it('falls back cleanly when productionAnalytics.day lacks summary totals and unit', async () => {
    const partialAnalytics = overviewPayload({
      productionAnalytics: {
        day: {
          label: 'Today vs Yesterday',
        },
      },
    })
    getDashboardOverview.mockResolvedValue(partialAnalytics)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(livePayload())

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Comparison unavailable')).toBeInTheDocument()
    const productionCard = screen.getByText('Production Output').closest('article')
    expect(productionCard).toHaveTextContent('5 pcs')
    const comparisonCard = screen.getByText('Difference from Yesterday').closest('article')
    expect(comparisonCard).toHaveTextContent('—')
    expect(document.body.textContent).not.toMatch(/undefined|NaN/)
  })

  it('marks Machine Online as 0 / 1 Sensors offline when live machine has an empty sensors array', async () => {
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(livePayload({ sensors: [] }))

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('0 / 5 reporting')).toBeInTheDocument()
    expect(screen.getByText('Spiral Mill 01 · Sensors offline')).toBeInTheDocument()
    const machineCard = screen.getByText('Machine Online').closest('article')
    expect(machineCard).toHaveTextContent('0 / 1')
    expect(machineCard).toHaveClass('stat-card-warning')
  })

  it('does not flash Partial sync while initial staggered sources are still loading and closes sync popover across 900px viewport changes', async () => {
    let matches = false
    const listeners = new Set()
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      get matches() {
        return query === '(max-width: 900px)' ? matches : false
      },
      media: query,
      addEventListener: vi.fn((type, listener) => {
        if (type === 'change') listeners.add(listener)
      }),
      removeEventListener: vi.fn((type, listener) => {
        if (type === 'change') listeners.delete(listener)
      }),
    }))

    const user = userEvent.setup()
    const pendingLive = deferred()
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockReturnValue(pendingLive.promise)

    try {
      renderWithAuth(<DashboardSection />)

      const syncTrigger = await screen.findByRole('button', { name: /sync status:/i })
      await waitFor(() => {
        expect(syncTrigger).not.toHaveTextContent(/Not synced/i)
      })
      expect(syncTrigger).not.toHaveTextContent(/Partial sync/i)
      expect(syncTrigger).not.toHaveClass('is-partial')

      await user.click(syncTrigger)
      expect(screen.getByRole('region', { name: 'Sync source breakdown' })).toBeInTheDocument()

      act(() => {
        matches = true
        listeners.forEach((listener) => listener({ matches: true, media: '(max-width: 900px)' }))
      })
      expect(screen.queryByRole('region', { name: 'Sync source breakdown' })).not.toBeInTheDocument()

      await act(async () => {
        pendingLive.reject(new Error('Live initial outage'))
        try {
          await pendingLive.promise
        } catch {
          // Expected failure to verify transition to partial sync after settling.
        }
      })

      const mobileTrigger = await screen.findByRole('button', { name: /sync status: partial sync/i })
      expect(mobileTrigger).toHaveClass('is-partial')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('coordinates live regions when overview, chart, and live fail together or while overview loading/stale suppresses secondary notices', async () => {
    getDashboardOverview.mockRejectedValue(new Error('Overview outage'))
    getDashboardDowntimeImpact.mockRejectedValue(new Error('Chart outage'))
    getLiveFeed.mockRejectedValue(new Error('Live outage'))

    const { unmount } = renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Overview outage')).toHaveAttribute('role', 'alert')
    const chartErrorNotice = (await screen.findByText('Chart outage')).closest('[role]')
    const liveErrorMessage = await screen.findByText('Live outage')
    expect(chartErrorNotice).toHaveAttribute('role', 'status')
    expect(chartErrorNotice).toHaveAttribute('aria-live', 'off')
    expect(liveErrorMessage).toHaveAttribute('role', 'status')
    expect(liveErrorMessage).toHaveAttribute('aria-live', 'off')

    unmount()

    const pendingOverview = deferred()
    const idleLive = livePayload()
    idleLive.sensors[0].status = 'Idle'
    getDashboardOverview.mockReturnValue(pendingOverview.promise)
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed.mockResolvedValue(idleLive)

    renderWithAuth(<DashboardSection />)

    const idleBanner = (await screen.findByText('S-01 Raw Material & Coil Joint is idle.')).closest('[role="status"]')
    expect(idleBanner).toHaveAttribute('aria-live', 'off')
  })

  it('clears stale live feed state when the auth token is removed', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact.mockResolvedValue(emptyDowntimePayload())
    getLiveFeed
      .mockResolvedValueOnce(livePayload())
      .mockRejectedValueOnce(new Error('Live refresh failed'))

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthContext.Provider value={{ token: 'token-a', user: { id: '1', role: 'Admin' } }}>
            <DashboardSection />
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh overview data' }))
    expect(await screen.findByText(/Live machine status is stale/i)).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthContext.Provider value={{ token: null, user: null }}>
            <DashboardSection />
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.queryByText(/Live machine status is stale/i)).not.toBeInTheDocument()
    })
  })
})
