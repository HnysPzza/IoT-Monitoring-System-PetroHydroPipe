import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AnalyticsKpiCard from './AnalyticsKpiCard.jsx'

const primaryKpi = {
  id: 'downtime',
  label: 'Downtime',
  value: '130 min',
  helper: '5 recorded events',
  isPrimary: true,
  delta: { direction: 'up', sentiment: 'negative', label: '+30.0%' },
  sparkline: [{ key: 'one', value: 20 }, { key: 'two', value: 30 }],
}

describe('AnalyticsKpiCard', () => {
  it('renders primary metric value, delta, caption, and decorative sparkline', () => {
    render(<AnalyticsKpiCard kpi={primaryKpi} selectedMetric="downtime" onSelect={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Downtime.*130 min.*\+30\.0%/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('5 recorded events')).toBeInTheDocument()
    expect(screen.getByTestId('analytics-kpi-sparkline')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps secondary metric cards compact without a sparkline', () => {
    render(<AnalyticsKpiCard kpi={{ ...primaryKpi, id: 'availability', label: 'Availability', isPrimary: false }} selectedMetric="availability" onSelect={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Availability.*130 min.*\+30\.0%/i })).toBeInTheDocument()
    expect(screen.queryByTestId('analytics-kpi-sparkline')).not.toBeInTheDocument()
  })
})
