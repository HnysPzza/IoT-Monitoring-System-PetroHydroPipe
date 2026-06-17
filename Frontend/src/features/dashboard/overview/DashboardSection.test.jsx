import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import DashboardSection from './DashboardSection.jsx'
import { getDashboardDowntimeImpact, getDashboardOverview } from './dashboardService.js'

vi.mock('./dashboardService.js', () => ({
  getDashboardOverview: vi.fn(),
  getDashboardDowntimeImpact: vi.fn(),
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
    productionAnalytics: {},
    availability: [{ machineId: 'Spiral Mill 01', percent: 98 }],
  }
}

describe('DashboardSection', () => {
  beforeEach(() => {
    getDashboardOverview.mockReset()
    getDashboardDowntimeImpact.mockReset()
  })

  it('reloads only the downtime chart when chart range changes', async () => {
    const user = userEvent.setup()

    getDashboardOverview.mockResolvedValue(overviewPayload())
    getDashboardDowntimeImpact
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: 'Mon', minutes: 10 }] } })
      .mockResolvedValueOnce({ downtimeImpact: { thresholdMinutes: 30, points: [{ label: '6 AM', minutes: 4 }] } })

    renderWithAuth(<DashboardSection />)

    expect(await screen.findByText('Production Output')).toBeInTheDocument()
    expect(await screen.findByTestId('downtime-chart')).toHaveTextContent('Downtime points: 1')

    await user.click(screen.getByRole('button', { name: /today/i }))

    await waitFor(() => {
      expect(getDashboardDowntimeImpact).toHaveBeenCalledTimes(2)
    })
    expect(getDashboardOverview).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Production Output')).toBeInTheDocument()
  })
})
