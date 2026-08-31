import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AnalyticsTrendExplorer from './AnalyticsTrendExplorer.jsx'
import { analyticsTestFixture } from './analyticsTestFixtures.js'

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children, data }) => <div data-testid="analytics-trend-chart" data-points={data.length}>{children}</div>,
  CartesianGrid: () => null,
  ReferenceLine: ({ label }) => <span>{label?.value}</span>,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

function snapshotWithSelectedTrends(trends) {
  return {
    ...analyticsTestFixture,
    trendAlignment: {
      ...analyticsTestFixture.trendAlignment,
      selectedBucketCount: trends.length,
      comparisonBucketCount: trends.length,
    },
    selected: { ...analyticsTestFixture.selected, trends },
    comparison: { ...analyticsTestFixture.comparison, trends: analyticsTestFixture.comparison.trends.slice(0, trends.length) },
  }
}

describe('AnalyticsTrendExplorer current marker', () => {
  it('waits for a second selected bucket before drawing the Now line', () => {
    const partialPoint = analyticsTestFixture.selected.trends.find((point) => point.periodState === 'partial')
    const { rerender } = render(
      <AnalyticsTrendExplorer snapshot={snapshotWithSelectedTrends([partialPoint])} metricId="process-events" />,
    )

    expect(screen.getByTestId('analytics-trend-chart')).toHaveAttribute('data-points', '1')
    expect(screen.queryByText('Now')).not.toBeInTheDocument()

    rerender(
      <AnalyticsTrendExplorer
        snapshot={snapshotWithSelectedTrends([analyticsTestFixture.selected.trends[0], partialPoint])}
        metricId="process-events"
      />,
    )

    expect(screen.getByText('Now')).toBeInTheDocument()
  })
})
