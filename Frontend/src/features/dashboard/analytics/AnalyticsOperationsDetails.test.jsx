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
      const sector = await waitFor(() => {
        const renderedSector = view.container.querySelector('.recharts-pie-sector')

        expect(renderedSector).toBeInTheDocument()
        return renderedSector
      })
      fireEvent.mouseEnter(sector)

      await waitFor(() => {
        const tooltip = view.container.querySelector('.analytics-cause-tooltip')

        expect(tooltip).toBeVisible()
        expect(tooltip).toHaveTextContent('Corrective Maintenance')
        expect(tooltip).toHaveTextContent('43 min')
        expect(tooltip).toHaveTextContent('33% of recorded downtime')
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

  it('filters the process event record by neutral sensor code', async () => {
    const user = userEvent.setup()
    renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)
    const processList = screen.getByRole('list', { name: 'Process event records' })

    expect(within(processList).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('table', { name: 'Process event records' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'S-04, 1 process event' }))

    expect(within(processList).getAllByRole('listitem')).toHaveLength(1)
    const selectedEvent = within(processList).getByRole('listitem')
    expect(within(selectedEvent).getByText('S-04')).toBeInTheDocument()
    expect(within(selectedEvent).getByText('Downtime detected')).toBeInTheDocument()
    expect(within(selectedEvent).getByText(/Aug 13, 2026/i).tagName).toBe('TIME')
    expect(selectedEvent.querySelector('time')).toHaveAttribute('dateTime', '2026-08-13T09:40:00+08:00')
  })

  it('resets to all sensors when a new snapshot still includes the previously selected sensor', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)

    await user.click(screen.getByRole('button', { name: 'S-04, 1 process event' }))
    expect(screen.getByRole('button', { name: 'S-04, 1 process event' })).toHaveAttribute('aria-pressed', 'true')

    const nextSnapshot = {
      ...buildAnalyticsSnapshot(),
      processEvents: [
        {
          id: 'next-process-001',
          occurredAt: '2026-08-15T08:00:00+08:00',
          sensorCode: 'S-04',
          eventType: 'Downtime detected',
        },
        {
          id: 'next-process-002',
          occurredAt: '2026-08-15T09:00:00+08:00',
          sensorCode: 'S-01',
          eventType: 'Process event recorded',
        },
      ],
    }
    rerender(<AnalyticsOperationsDetails snapshot={nextSnapshot} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'All sensors' })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(within(screen.getByRole('list', { name: 'Process event records' })).getAllByRole('listitem')).toHaveLength(2)
  })
})
