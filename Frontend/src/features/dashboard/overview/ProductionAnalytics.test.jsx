import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProductionAnalytics from './ProductionAnalytics.jsx'

vi.mock('recharts', () => ({
  Area: () => null,
  CartesianGrid: () => null,
  ComposedChart: ({ children }) => <div data-testid="production-chart">{children}</div>,
  Line: () => null,
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
      unit: 'pipes',
      points: [
        { label: '6AM', current: 8, previous: 7 },
        { label: '9AM', current: 16, previous: 14 },
        { label: '12PM', current: 26, previous: 23 },
      ],
      ...overrides,
    },
  }
}

describe('ProductionAnalytics', () => {
  it('shows today against yesterday without target controls or target data', () => {
    render(<ProductionAnalytics analytics={buildAnalytics()} />)

    expect(screen.getByRole('heading', { name: 'Today so far vs Yesterday at same time' })).toBeInTheDocument()
    expect(screen.getByText('+13.0%')).toBeInTheDocument()
    expect(screen.getByText('Today so far is 13.0% above yesterday at same time.')).toBeInTheDocument()
    expect(screen.queryByText(/target/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day' })).not.toBeInTheDocument()
  })

  it('describes lower and equal output without treating equality as an increase', () => {
    const { rerender } = render(
      <ProductionAnalytics analytics={buildAnalytics({ currentTotal: 20, difference: -3, differencePercent: -13.04 })} />,
    )

    expect(screen.getByText('-13.0%')).toBeInTheDocument()
    expect(screen.getByText('Today so far is 13.0% below yesterday at same time.')).toBeInTheDocument()

    rerender(<ProductionAnalytics analytics={buildAnalytics({ currentTotal: 23, difference: 0, differencePercent: 0 })} />)

    expect(screen.getByText('No change')).toBeInTheDocument()
    expect(screen.getByText('Today so far matches yesterday at same time at 23 pipes.')).toBeInTheDocument()
  })

  it('does not invent a percentage when yesterday has no output', () => {
    render(
      <ProductionAnalytics analytics={buildAnalytics({ previousTotal: 0, currentTotal: 4, difference: 4, differencePercent: null })} />,
    )

    expect(screen.getByText('No baseline')).toBeInTheDocument()
    expect(screen.getByText('Today so far recorded 4 pipes; yesterday at same time recorded none.')).toBeInTheDocument()
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  })
})
