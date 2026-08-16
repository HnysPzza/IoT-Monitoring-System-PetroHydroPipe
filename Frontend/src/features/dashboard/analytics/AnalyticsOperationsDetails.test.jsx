import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsOperationsDetails from './AnalyticsOperationsDetails.jsx'
import { buildAnalyticsSnapshot } from './analyticsService.js'

describe('AnalyticsOperationsDetails', () => {
  it('renders the cause distribution chart with a semantic legend and no downtime event table', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)
    const causeLegend = screen.getByRole('list', { name: 'Downtime cause distribution' })

    expect(container.querySelector('.analytics-cause-chart')).toHaveAttribute('aria-hidden', 'true')
    expect(within(causeLegend).getAllByRole('listitem')).toHaveLength(5)
    expect(within(causeLegend).getByText('Corrective Maintenance')).toBeInTheDocument()
    expect(within(causeLegend).getByText('43 min - 33% of recorded downtime')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Downtime event records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Downtime events' })).not.toBeInTheDocument()
  })

  it('shows the local cause details tooltip when a donut sector is hovered', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) {
        this.callback = callback
      }

      observe() {
        this.callback([{ contentRect: { width: 320, height: 220 } }])
      }

      disconnect() {}
    })

    let view
    try {
      view = renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)
      const sectors = await waitFor(() => {
        const renderedSectors = view.container.querySelectorAll('.recharts-pie-sector')

        expect(renderedSectors).toHaveLength(5)
        return renderedSectors
      })
      const causeChart = view.container.querySelector('.analytics-cause-chart')
      const focusableChartDescendants = Array.from(causeChart.querySelectorAll('*')).filter(
        (element) => element.tabIndex >= 0,
      )

      expect(causeChart).toHaveAttribute('aria-hidden', 'true')
      expect(focusableChartDescendants).toHaveLength(0)

      fireEvent.mouseEnter(sectors[0])

      await waitFor(() => {
        const tooltip = view.container.querySelector('.analytics-cause-tooltip')

        expect(tooltip).toBeVisible()
        expect(tooltip).toHaveTextContent('Corrective Maintenance')
        expect(tooltip).toHaveTextContent('43 min')
        expect(tooltip).toHaveTextContent('33% of recorded downtime')
      })

      fireEvent.mouseEnter(sectors[sectors.length - 1])

      await waitFor(() => {
        const tooltip = view.container.querySelector('.analytics-cause-tooltip')

        expect(tooltip).toBeVisible()
        expect(tooltip).toHaveTextContent('Flux Refill')
        expect(tooltip).toHaveTextContent('12 min')
        expect(tooltip).toHaveTextContent('9% of recorded downtime')
      })
    } finally {
      view?.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('shows an explicit no-cause state without drawing a chart or inventing cause rows', () => {
    const snapshot = {
      ...buildAnalyticsSnapshot(),
      downtimeEvents: [],
    }
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={snapshot} />)
    const noCauseState = screen.getByRole('status', { name: 'No downtime causes recorded' })

    expect(screen.getByText('No downtime causes recorded')).toBeInTheDocument()
    expect(within(noCauseState).getByText('0 min recorded')).toBeInTheDocument()
    expect(within(noCauseState).getByText('No local downtime records fall within the selected date range.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Downtime cause distribution' })).not.toBeInTheDocument()
    expect(container.querySelector('.analytics-cause-chart')).not.toBeInTheDocument()
  })

  it('keeps every cause in the semantic legend when more causes exist than the color palette', () => {
    const snapshot = {
      ...buildAnalyticsSnapshot(),
      downtimeEvents: Array.from({ length: 7 }, (_, index) => ({
        id: `test-downtime-${index + 1}`,
        startedAt: `2026-08-${String(10 + index).padStart(2, '0')}T08:00:00+08:00`,
        durationMinutes: index + 1,
        cause: `Cause ${index + 1}`,
        sensorCode: 'S-01',
      })),
    }
    renderWithAuth(<AnalyticsOperationsDetails snapshot={snapshot} />)
    const causeLegend = screen.getByRole('list', { name: 'Downtime cause distribution' })

    expect(within(causeLegend).getAllByRole('listitem')).toHaveLength(7)
    Array.from({ length: 7 }, (_, index) => `Cause ${index + 1}`).forEach((cause) => {
      expect(within(causeLegend).getByText(cause)).toBeInTheDocument()
    })
  })

  it('renders the process event distribution count chart with a semantic sensor list', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)
    const sensorLegend = screen.getByRole('list', { name: 'Process event distribution' })

    expect(container.querySelector('.analytics-sensor-chart')).toHaveAttribute('aria-hidden', 'true')
    expect(within(sensorLegend).getAllByRole('listitem')).toHaveLength(5)
    expect(within(sensorLegend).getByText('S-01')).toBeInTheDocument()
    expect(within(sensorLegend).getByText('1 event - 20% of process events')).toBeInTheDocument()
    expect(within(sensorLegend).getByText('S-05')).toBeInTheDocument()
  })

  it('shows the sensor details tooltip when a bar in the distribution chart is hovered', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) {
        this.callback = callback
      }

      observe() {
        this.callback([{ contentRect: { width: 320, height: 220 } }])
      }

      disconnect() {}
    })

    let view
    try {
      view = renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)
      const rectangles = await waitFor(() => {
        const renderedBars = view.container.querySelectorAll('.recharts-bar-rectangle')
        expect(renderedBars).toHaveLength(5)
        return renderedBars
      })

      fireEvent.mouseEnter(rectangles[0])

      await waitFor(() => {
        const tooltip = view.container.querySelector('.analytics-sensor-tooltip')
        expect(tooltip).toBeVisible()
        expect(tooltip).toHaveTextContent('Sensor S-01')
        expect(tooltip).toHaveTextContent('1 event')
        expect(tooltip).toHaveTextContent('20% of process events')
      })
    } finally {
      view?.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('shows an explicit no-process-events state when snapshot contains no process events', () => {
    const snapshot = {
      ...buildAnalyticsSnapshot(),
      processEvents: [],
    }
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={snapshot} />)
    const noProcessState = screen.getByRole('status', { name: 'No process events recorded' })

    expect(screen.getByText('No process events recorded')).toBeInTheDocument()
    expect(within(noProcessState).getByText('0 events recorded')).toBeInTheDocument()
    expect(within(noProcessState).getByText('No local process events fall within the selected date range.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Process event distribution' })).not.toBeInTheDocument()
    expect(container.querySelector('.analytics-sensor-chart')).not.toBeInTheDocument()
  })
})
