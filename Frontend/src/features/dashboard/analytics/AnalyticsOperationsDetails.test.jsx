import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsOperationsDetails, { getDonutDisplayMinutes } from './AnalyticsOperationsDetails.jsx'
import { analyticsTestFixture } from './analyticsTestFixtures.js'

vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts')
  const { cloneElement } = await import('react')

  return {
    ...actual,
    ResponsiveContainer: ({ children, height }) => cloneElement(children, { width: 400, height }),
  }
})

function withSelected(overrides) {
  return {
    ...analyticsTestFixture,
    selected: { ...analyticsTestFixture.selected, ...overrides },
  }
}

describe('AnalyticsOperationsDetails', () => {
  it('renders five backend-ranked downtime sensors and maintenance causes', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={analyticsTestFixture} />)
    const legend = screen.getByRole('list', { name: 'Sensor downtime distribution' })

    expect(container.querySelector('.analytics-cause-chart')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('heading', { name: 'Downtime by sensor' })).toBeInTheDocument()
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5)
    expect(within(legend).getByText('S-01 — Raw Material & Coil Joint')).toBeInTheDocument()
    expect(within(within(legend).getByText('S-01 — Raw Material & Coil Joint').closest('li')).getByText('2 downtime events')).toBeInTheDocument()
    expect(within(legend).queryByText(/maintenance events/i)).not.toBeInTheDocument()
    expect(within(legend).getByText(/1 hr 1 min - 47% of sensor downtime/i)).toBeInTheDocument()

    const causes = screen.getByRole('list', { name: 'Downtime cause distribution' })
    expect(screen.getByRole('heading', { name: 'Downtime by cause' }).closest('section')).not.toBe(
      screen.getByRole('heading', { name: 'Downtime by sensor' }).closest('section'),
    )
    expect(screen.getByRole('heading', { name: 'Downtime by cause' }).closest('section')).toHaveClass('analytics-cause-detail-card')
    const maintenanceCause = within(causes).getByText('Corrective Maintenance').closest('li')
    expect(maintenanceCause).toHaveTextContent(/2 downtime events/i)
    expect(maintenanceCause).toHaveTextContent(/3\.05 pcs estimated loss/i)
  })

  it('applies legend hover and focus state to the matching donut sector', async () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={analyticsTestFixture} />)
    const legend = screen.getByRole('list', { name: 'Sensor downtime distribution' })
    const first = within(legend).getByText('S-01 — Raw Material & Coil Joint').closest('li')
    const second = within(legend).getByText('S-02 — Inside Filler Wire').closest('li')

    fireEvent.mouseEnter(first)
    expect(first).toHaveClass('is-hovered')
    await waitFor(() => expect(container.querySelector('.analytics-donut-active-sector')).toBeInTheDocument())
    fireEvent.mouseEnter(second)
    expect(first).not.toHaveClass('is-hovered')
    expect(second).toHaveClass('is-hovered')

    fireEvent.mouseLeave(second)
    await waitFor(() => expect(container.querySelector('.analytics-donut-active-sector')).not.toBeInTheDocument())
    fireEvent.focus(first)
    expect(first).toHaveClass('is-hovered')
    await waitFor(() => expect(container.querySelector('.analytics-donut-active-sector')).toBeInTheDocument())
  })

  it('shows an honest empty state when all five sensors have zero downtime', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeSensors: analyticsTestFixture.selected.downtimeSensors.map((sensor) => ({ ...sensor, eventCount: 0, durationMinutes: 0 })),
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 0, downtimeEventCount: 0 },
    })} />)
    expect(container.querySelector('.analytics-empty-donut')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'No sensor downtime recorded' })).toHaveTextContent('0 min recorded')
  })

  it('discloses zero-minute downtime records instead of calling them absent', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeSensors: analyticsTestFixture.selected.downtimeSensors.map((sensor) => ({
        ...sensor,
        eventCount: sensor.sensorCode === 'S-03' ? 2 : 0,
        durationMinutes: 0,
      })),
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 0, downtimeEventCount: 2 },
    })} />)

    expect(screen.getByRole('status', { name: 'Downtime recorded under one minute' })).toHaveTextContent('2 recorded events')
    expect(screen.getByText('Recorded downtime rounds to 0 min in this view.')).toBeInTheDocument()
  })

  it('discloses downtime excluded while cause review remains pending', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeCauses: [],
      causeCoverage: {
        reviewedDurationMinutes: 0,
        pendingReviewDurationMinutes: 60,
        pendingReviewEventCount: 1,
        coveragePercent: 0,
      },
    })} />)

    expect(screen.getByRole('status')).toHaveTextContent('1 downtime event is awaiting cause review')
    expect(screen.getByRole('status')).toHaveTextContent('1 hr remains excluded from cause percentages')
    expect(screen.getByText('No reviewed downtime causes are available for this range.')).toBeInTheDocument()
  })

  it('calculates donut percentages from sensor readings rather than unioned machine downtime', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeSensors: analyticsTestFixture.selected.downtimeSensors.map((sensor) => ({
        ...sensor,
        durationMinutes: sensor.sensorCode === 'S-01' ? 60 : sensor.sensorCode === 'S-02' ? 40 : 0,
      })),
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 75 },
    })} />)

    const legend = screen.getByRole('list', { name: 'Sensor downtime distribution' })
    expect(within(legend).getByText(/1 hr - 60% of sensor downtime/i)).toBeInTheDocument()
  })

  it('shows a non-zero sensor duration below one percent as less than one percent', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeSensors: analyticsTestFixture.selected.downtimeSensors.map((sensor) => ({
        ...sensor,
        durationMinutes: sensor.sensorCode === 'S-01' ? 999 : sensor.sensorCode === 'S-02' ? 1 : 0,
      })),
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 1000 },
    })} />)

    const legend = screen.getByRole('list', { name: 'Sensor downtime distribution' })
    expect(within(legend).getByText(/1 min - <1% of sensor downtime/i)).toBeInTheDocument()
    expect(screen.getByText('Non-zero shares below 1% use a minimum visible slice.')).toBeInTheDocument()
    expect(getDonutDisplayMinutes(1, 1000)).toBe(10)
    expect(getDonutDisplayMinutes(0, 1000)).toBe(0)
  })

  it('renders only server-authorized process sensors with labels and a decorative chart', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={analyticsTestFixture} />)
    const legend = screen.getByRole('list', { name: 'Process event distribution' })

    expect(container.querySelector('.analytics-sensor-chart')).toHaveAttribute('aria-hidden', 'true')
    expect(within(legend).getAllByRole('listitem')).toHaveLength(3)
    expect(within(legend).getByText('S-01 — Raw Material & Coil Joint')).toBeInTheDocument()
    expect(within(legend).queryByText(/^S-03/)).not.toBeInTheDocument()
    expect(within(legend).queryByText(/^S-05/)).not.toBeInTheDocument()
  })

  it('shows an honest empty process state when the server returns no process sensors', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      processSensors: analyticsTestFixture.selected.processSensors.map((sensor) => ({ ...sensor, eventCount: 0 })),
      summary: { ...analyticsTestFixture.selected.summary, processEventCount: 0 },
    })} />)
    expect(container.querySelector('.analytics-empty-bars')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'No process events recorded' })).toHaveTextContent('0 events recorded')
  })

  it('keeps future downtime and process summaries unobserved instead of coercing them to zero', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeSensors: [],
      processSensors: [],
      summary: {
        ...analyticsTestFixture.selected.summary,
        downtimeMinutes: null,
        downtimeEventCount: null,
        processEventCount: null,
      },
    })} />)

    expect(screen.getByRole('status', { name: 'Downtime not observed' })).toHaveTextContent('Not observed')
    expect(screen.getByRole('status', { name: 'Process events not observed' })).toHaveTextContent('Not observed')
    expect(screen.queryByText('0 min recorded')).not.toBeInTheDocument()
    expect(screen.queryByText('0 events recorded')).not.toBeInTheDocument()
  })
})
