import { cloneElement, isValidElement } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProductionAnalytics from './ProductionAnalytics.jsx'

const mockTooltipState = vi.hoisted(() => ({ props: null }))

vi.mock('recharts', () => ({
  Area: ({ isAnimationActive, name }) => (
    <span data-testid="area-series" data-animation={String(isAnimationActive)} data-name={name} />
  ),
  CartesianGrid: () => null,
  ComposedChart: ({ children, data }) => <div data-testid="production-chart" data-points={data.map((point) => point.label).join(',')}>{children}</div>,
  Line: ({ isAnimationActive, name }) => (
    <span data-testid="line-series" data-animation={String(isAnimationActive)} data-name={name} />
  ),
  ReferenceLine: ({ label }) => (
    <span
      data-testid="now-reference-line"
      data-position={label?.position}
      data-fontsize={String(label?.fontSize)}
    >
      {label?.value}
    </span>
  ),
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: ({ content }) => (
    mockTooltipState.props && isValidElement(content)
      ? cloneElement(content, mockTooltipState.props)
      : null
  ),
  XAxis: ({ minTickGap }) => <span data-testid="production-xaxis" data-min-tick-gap={String(minTickGap)} />,
  YAxis: () => null,
}))

afterEach(() => {
  mockTooltipState.props = null
})

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

  it('renders clear Production Output Today scope, disables chart entrance animation, and lifts Now label out of plot area', () => {
    render(<ProductionAnalytics analytics={buildAnalytics()} />)

    expect(screen.getByText('Production Output · Today')).toBeInTheDocument()
    expect(screen.getByTestId('area-series')).toHaveAttribute('data-animation', 'false')
    expect(screen.getByTestId('line-series')).toHaveAttribute('data-animation', 'false')
    expect(screen.getByTestId('now-reference-line')).toHaveAttribute('data-position', 'top')
    expect(screen.getByTestId('now-reference-line')).toHaveAttribute('data-fontsize', '12')
    expect(screen.getByTestId('production-xaxis')).toHaveAttribute('data-min-tick-gap', '14')
  })

  it('renders safely when analytics or day points are missing', () => {
    const { container, rerender } = render(<ProductionAnalytics analytics={null} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<ProductionAnalytics analytics={{}} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<ProductionAnalytics analytics={{ day: { label: 'Today vs Yesterday' } }} />)
    expect(container).toBeEmptyDOMElement()

    rerender(
      <ProductionAnalytics
        analytics={{
          day: {
            points: [{ label: '6AM', current: 1, previous: 0 }],
            currentTotal: 1,
            previousTotal: 0,
          },
        }}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Production Output' })).toBeInTheDocument()
    expect(screen.getByText('Today (1)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (0)')).toBeInTheDocument()
    expect(container.textContent).not.toContain('undefined')

    rerender(
      <ProductionAnalytics
        analytics={{
          day: {
            points: [{ label: '6AM', current: 1, previous: 0 }],
          },
        }}
      />,
    )
    expect(screen.getByText('Today (—)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (—)')).toBeInTheDocument()
    expect(screen.getByTestId('area-series')).toHaveAttribute('data-name', 'Today')
    expect(screen.getByTestId('line-series')).toHaveAttribute('data-name', 'Yesterday')
    expect(container.textContent).not.toMatch(/undefined|NaN/)
  })

  it('formats non-finite legend totals and chart tooltip values without undefined or NaN', () => {
    mockTooltipState.props = {
      active: true,
      label: '6AM',
      payload: [
        { dataKey: 'current', name: 'Today', value: 1, color: '#111', payload: { label: '6AM' } },
        { dataKey: 'previous', name: 'Yesterday', value: Number.NaN, color: '#666', payload: { label: '6AM' } },
      ],
    }

    const { container, rerender } = render(
      <ProductionAnalytics
        analytics={{
          day: {
            currentTotal: Number.NaN,
            previousTotal: Number.POSITIVE_INFINITY,
            unit: 'pcs',
            points: [{ label: '6AM', current: 1, previous: 0 }],
          },
        }}
      />,
    )

    expect(screen.getByText('Today (—)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (—)')).toBeInTheDocument()
    expect(screen.getByText('Today: 1 pcs')).toBeInTheDocument()
    expect(screen.getByText('Yesterday: —')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/undefined|NaN/)

    mockTooltipState.props = {
      active: true,
      label: '9AM',
      payload: [
        { dataKey: 'current', name: 'Today', value: 12, color: '#111', payload: { label: '9AM' } },
        { dataKey: 'previous', name: 'Yesterday', value: null, color: '#666', payload: { label: '9AM' } },
      ],
    }

    rerender(
      <ProductionAnalytics
        analytics={{
          day: {
            points: [{ label: '9AM', current: 12, previous: null }],
          },
        }}
      />,
    )

    expect(screen.getByText('Today: 12')).toBeInTheDocument()
    expect(screen.getByText('Yesterday: —')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/undefined|NaN/)

    mockTooltipState.props = {
      active: true,
      label: '6AM',
      payload: [
        { dataKey: 'current', name: 'Today so far', value: 0, color: '#111', payload: { label: '6AM' } },
        { dataKey: 'previous', name: 'Yesterday at same time', value: null, color: '#666', payload: { label: '6AM' } },
      ],
    }

    rerender(
      <ProductionAnalytics
        analytics={{
          day: {
            currentLabel: 'Today so far',
            previousLabel: 'Yesterday at same time',
            currentTotal: 0,
            previousTotal: null,
            unit: 'pcs',
            points: [{ label: '6AM', current: 0, previous: null }],
          },
        }}
      />,
    )

    expect(screen.getByText('Today (0 pcs)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday (—)')).toBeInTheDocument()
    expect(screen.getByTestId('area-series')).toHaveAttribute('data-name', 'Today so far')
    expect(screen.getByTestId('line-series')).toHaveAttribute('data-name', 'Yesterday at same time')
    expect(screen.getByText('Today so far: 0 pcs')).toBeInTheDocument()
    expect(screen.getByText('Yesterday at same time: —')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/undefined|NaN/)
  })
})
