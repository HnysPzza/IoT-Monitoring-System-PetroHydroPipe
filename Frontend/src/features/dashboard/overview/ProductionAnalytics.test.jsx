import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProductionAnalytics from './ProductionAnalytics.jsx'

vi.mock('recharts', () => ({
  Area: () => null,
  CartesianGrid: () => null,
  ComposedChart: ({ children, data }) => <div data-testid="production-chart" data-points={data.map((point) => point.label).join(',')}>{children}</div>,
  Line: () => null,
  ReferenceLine: ({ label }) => <span>{label?.value}</span>,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

function buildAnalytics(overrides = {}) {
  return {
    day: {
      label: 'Today so far vs Yesterday at same time',
      currentLabel: 'Today so far',
      previousLabel: 'Yesterday at same time',
      currentTotal: 26,
      previousTotal: 23,
      difference: 3,
      differencePercent: 13.04,
      unit: 'pcs',
      points: [
        { label: '6AM', current: 8, previous: 7, periodState: 'completed' },
        { label: '9AM', current: 16, previous: 14, periodState: 'current' },
        { label: '12PM', current: null, previous: null, periodState: 'future' },
      ],
      ...overrides,
    },
  }
}

describe('ProductionAnalytics', () => {
  it('shows today against yesterday without target controls or target data', () => {
    render(<ProductionAnalytics analytics={buildAnalytics()} />)

    expect(screen.getByRole('heading', { name: 'Today so far vs Yesterday at same time' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Today so far vs Yesterday at same time production output comparison chart' })).toBeInTheDocument()
    expect(screen.getByText('Today (26 pcs)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (23 pcs)')).toBeInTheDocument()
    expect(screen.queryByText('+13.0%')).not.toBeInTheDocument()
    expect(screen.queryByText(/target/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day' })).not.toBeInTheDocument()
    expect(screen.getByText('Now')).toBeInTheDocument()
    expect(screen.getByTestId('production-chart')).toHaveAttribute('data-points', '6AM,9AM')
    expect(screen.queryByText('Future')).not.toBeInTheDocument()
  })

  it('describes lower and equal output without treating equality as an increase', () => {
    const { rerender } = render(
      <ProductionAnalytics analytics={buildAnalytics({ currentTotal: 20, difference: -3, differencePercent: -13.04 })} />,
    )

    expect(screen.getByText('Today (20 pcs)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (23 pcs)')).toBeInTheDocument()

    rerender(<ProductionAnalytics analytics={buildAnalytics({ currentTotal: 23, difference: 0, differencePercent: 0 })} />)

    expect(screen.getByText('Today (23 pcs)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (23 pcs)')).toBeInTheDocument()
  })

  it('does not invent a percentage when yesterday has no output', () => {
    render(
      <ProductionAnalytics analytics={buildAnalytics({ previousTotal: 0, currentTotal: 4, difference: 4, differencePercent: null })} />,
    )

    expect(screen.getByText('Today (4 pcs)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (0 pcs)')).toBeInTheDocument()
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  })

  it('does not draw a misleading Now line when only one bucket is visible', () => {
    render(<ProductionAnalytics analytics={buildAnalytics({
      points: [{ label: '6AM', current: 1, previous: 0, periodState: 'current' }],
    })} />)

    expect(screen.queryByText('Now')).not.toBeInTheDocument()
    expect(screen.getByTestId('production-chart')).toHaveAttribute('data-points', '6AM')
  })
})
