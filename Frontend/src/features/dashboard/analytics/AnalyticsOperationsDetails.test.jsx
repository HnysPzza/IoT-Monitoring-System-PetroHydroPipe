import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsOperationsDetails from './AnalyticsOperationsDetails.jsx'
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
  it('renders compact downtime causes beside process event distribution', () => {
    const { container } = renderWithAuth(<AnalyticsOperationsDetails snapshot={analyticsTestFixture} />)
    const causeCard = screen.getByRole('heading', { name: 'Downtime by cause' }).closest('section')
    const causes = within(causeCard).getByRole('list', { name: 'Downtime cause distribution' })

    expect(within(causes).getAllByRole('listitem')).toHaveLength(3)
    expect(within(causes).getByText('Corrective Maintenance')).toBeInTheDocument()
    expect(within(causes).getByText('47%')).toBeInTheDocument()
    expect(container.querySelectorAll('.analytics-operations-layout > section')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Event distribution' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Downtime by sensor' })).not.toBeInTheDocument()
  })

  it('aggregates causes after the top three into one compact row', () => {
    const snapshot = withSelected({
      downtimeCauses: [
        ...analyticsTestFixture.selected.downtimeCauses,
        { cause: 'Hydraulic Failure', eventCount: 2, durationMinutes: 20, estimatedLossPieces: 1 },
        { cause: 'Other', eventCount: 1, durationMinutes: 10, estimatedLossPieces: 0.5 },
      ],
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 160 },
      causeCoverage: { ...analyticsTestFixture.selected.causeCoverage, reviewedDurationMinutes: 160 },
    })
    renderWithAuth(<AnalyticsOperationsDetails snapshot={snapshot} />)

    const causes = screen.getByRole('list', { name: 'Downtime cause distribution' })
    const remaining = within(causes).getByRole('listitem', { name: /Remaining causes/i })
    expect(within(causes).getAllByRole('listitem')).toHaveLength(4)
    expect(remaining).toHaveTextContent('19%')
    expect(remaining).toHaveAttribute('aria-label', expect.stringContaining('3 downtime events'))
  })

  it('uses reviewed downtime as cause percentage denominator', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeCauses: [{ cause: 'Corrective Maintenance', eventCount: 1, durationMinutes: 60, estimatedLossPieces: 3 }],
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 120, downtimeEventCount: 2 },
      causeCoverage: {
        reviewedDurationMinutes: 60,
        pendingReviewDurationMinutes: 60,
        pendingReviewEventCount: 1,
        coveragePercent: 50,
      },
    })} />)

    expect(screen.getByRole('list', { name: 'Downtime cause distribution' })).toHaveTextContent('100%')
    expect(screen.getByRole('list', { name: 'Downtime cause distribution' })).not.toHaveTextContent('50%')
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

  it('discloses zero-minute downtime records instead of calling them absent', () => {
    renderWithAuth(<AnalyticsOperationsDetails snapshot={withSelected({
      downtimeCauses: [{ cause: 'Corrective Maintenance', eventCount: 2, durationMinutes: 0, estimatedLossPieces: 0 }],
      summary: { ...analyticsTestFixture.selected.summary, downtimeMinutes: 0, downtimeEventCount: 2 },
      causeCoverage: {
        reviewedDurationMinutes: 0,
        pendingReviewDurationMinutes: 0,
        pendingReviewEventCount: 0,
        coveragePercent: 100,
      },
    })} />)

    expect(screen.getByRole('status', { name: 'Downtime recorded under one minute' })).toHaveTextContent('2 recorded events')
    expect(screen.getByText('Recorded downtime rounds to 0 min in this view.')).toBeInTheDocument()
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
