import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DowntimeTrendChart from './DowntimeTrendChart.jsx'

vi.mock('recharts', () => ({
  Bar: ({ children, isAnimationActive }) => <div data-testid="downtime-bar-series" data-animation={String(isAnimationActive)}>{children}</div>,
  BarChart: ({ children }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  ReferenceLine: ({ label }) => <span data-testid="threshold-line" data-has-label={String(Boolean(label))} />,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: ({ interval, minTickGap }) => <span data-testid="downtime-xaxis" data-interval={interval ?? 'default'} data-min-tick-gap={String(minTickGap)} />,
  YAxis: () => null,
}))

describe('DowntimeTrendChart', () => {
  it('summarizes observed periods without presenting future periods as downtime', () => {
    render(
      <DowntimeTrendChart
        lossEstimateBasis={{ source: 'configured-fallback', ratePiecesPerMinute: 0.05 }}
        data={[
          { label: '12-6AM', minutes: 0, periodState: 'completed' },
          { label: '6-9AM', minutes: 8, periodState: 'current' },
          { label: '9AM-12PM', minutes: null, periodState: 'future' },
          { label: '12-3PM', minutes: null, periodState: 'future' },
        ]}
      />,
    )

    expect(screen.getByText('12-6AM: 0m')).toBeInTheDocument()
    expect(screen.getByText('6-9AM: 8m so far')).toBeInTheDocument()
    expect(screen.queryByText(/9AM-12PM:/)).not.toBeInTheDocument()
    expect(screen.getByText('2 future periods not reached')).toBeInTheDocument()
    expect(screen.getByText('Estimated loss uses configured fallback: 3 pcs/hr.')).toBeInTheDocument()
    expect(screen.getByText('Under 30m')).toBeInTheDocument()
    expect(screen.getByText('30m+')).toBeInTheDocument()
    expect(screen.getByText('30m threshold')).toBeInTheDocument()
    expect(screen.getByTestId('downtime-bar-series')).toHaveAttribute('data-animation', 'false')
    expect(screen.getByTestId('threshold-line')).toHaveAttribute('data-has-label', 'false')
    expect(screen.getByTestId('downtime-xaxis')).toHaveAttribute('data-interval', 'default')
    expect(screen.getByTestId('downtime-xaxis')).toHaveAttribute('data-min-tick-gap', '12')
  })

  it('includes all observed periods in the summary list, renders a fallback table, and guards non-finite values', () => {
    const { container } = render(
      <DowntimeTrendChart
        lossEstimateBasis={{ source: 'configured-fallback', ratePiecesPerMinute: 0.05 }}
        data={[
          { label: 'P1', minutes: 2, periodState: 'completed' },
          { label: 'P2', minutes: 4, periodState: 'completed' },
          { label: 'P3', minutes: 6, periodState: 'completed' },
          { label: 'P4', minutes: 8, periodState: 'completed' },
          { label: 'P5', minutes: 10, periodState: 'completed' },
          { label: 'P6', minutes: null, periodState: 'completed' },
        ]}
      />,
    )

    expect(screen.getByText('P1: 2m')).toBeInTheDocument()
    expect(screen.getByText('P5: 10m')).toBeInTheDocument()
    expect(screen.getByText('P6: —')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/nullm|NaNm|undefined/)

    const fallbackTable = screen.getByRole('table', { name: /downtime trend data/i })
    expect(fallbackTable).toBeInTheDocument()
    expect(fallbackTable.querySelectorAll('tbody tr')).toHaveLength(6)
  })
})
