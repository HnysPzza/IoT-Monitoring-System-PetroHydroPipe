import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import DashboardSection from './DashboardSection.jsx'
import { getDashboardDowntimeImpact, getDashboardOverview } from './dashboardService.js'
import { getLiveFeed } from '../live/liveService.js'

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
    default: ({ data }) => <div data-testid="downtime-chart">Downtime points: {data.length}</div>,
  }
})

function overviewPayload() {
  return {
    alerts: [],
    summary: [{ id: 'output', label: 'Production Output', value: '5 pcs', helper: 'Today' }],
    productionAnalytics: {
      day: {
        currentTotal: 5,
        targetTotal: 1400,
        unit: 'pcs',
        currentLabel: 'Today',
        label: 'Daily Output',
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

describe('DashboardSection', () => {
  beforeEach(() => {
    getDashboardOverview.mockReset()
    getDashboardDowntimeImpact.mockReset()
    getLiveFeed.mockReset()
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
    expect(screen.getByText('Target Production Output')).toBeInTheDocument()
    expect(screen.getByText('5 / 5 sensors reporting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /last hour/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /weekly/i }))

    await waitFor(() => {
      expect(getDashboardDowntimeImpact).toHaveBeenCalledTimes(2)
    })
    expect(getDashboardOverview).toHaveBeenCalledTimes(1)
    expect(getLiveFeed).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Production Output')).toBeInTheDocument()
  })
})
