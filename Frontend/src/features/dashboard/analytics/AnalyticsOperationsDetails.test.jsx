import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsOperationsDetails from './AnalyticsOperationsDetails.jsx'
import { analyticsTestFixture } from './analyticsTestFixtures.js'

function withSelected(overrides) {
  return {
    ...analyticsTestFixture,
    selected: { ...analyticsTestFixture.selected, ...overrides },
  }
}

describe('AnalyticsOperationsDetails', () => {
  it('renders backend cause aggregates with a semantic legend and decorative chart', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={analyticsTestFixture} />)
    const legend = screen.getByRole('list', { name: 'Downtime cause distribution' })

    expect(container.querySelector('.analytics-cause-chart')).toHaveAttribute('aria-hidden', 'true')
    expect(within(legend).getAllByRole('listitem')).toHaveLength(3)
    expect(within(legend).getByText('Corrective Maintenance')).toBeInTheDocument()
    expect(within(legend).getByText(/1 hr 1 min - 47% of recorded downtime/i)).toBeInTheDocument()
  })

  it('keeps semantic legend hover state outside the hidden chart', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={analyticsTestFixture} />)
    const legend = screen.getByRole('list', { name: 'Downtime cause distribution' })
    const first = within(legend).getByText('Corrective Maintenance').closest('li')
    const second = within(legend).getByText('Weld Wire Refill').closest('li')

    fireEvent.mouseEnter(first)
    expect(first).toHaveClass('is-hovered')
    fireEvent.mouseEnter(second)
    expect(first).not.toHaveClass('is-hovered')
    expect(second).toHaveClass('is-hovered')
  })

  it('shows an honest empty cause state when the server returns no causes', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeCauses: [],
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 0, downtimeEventCount: 0 },
    })} />)
    expect(container.querySelector('.analytics-empty-donut')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'No downtime causes recorded' })).toHaveTextContent('0 min recorded')
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
      downtimeCauses: [],
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
