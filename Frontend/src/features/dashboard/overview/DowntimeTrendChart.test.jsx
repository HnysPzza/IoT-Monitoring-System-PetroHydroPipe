import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DowntimeTrendChart from './DowntimeTrendChart.jsx'

vi.mock('recharts', () => ({
  Bar: ({ children }) => <div>{children}</div>,
  BarChart: ({ children }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
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
    expect(screen.getByText('Estimated loss uses configured fallback: 0.05 pcs/min.')).toBeInTheDocument()
  })
})
