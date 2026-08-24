import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnimatedAnalytics } from './AnimatedAnalytics.jsx'

describe('AnimatedAnalytics', () => {
  it('renders SVG with static bars and dynamic trendline', () => {
    const { container } = render(<AnimatedAnalytics />)
    const svg = container.querySelector('svg.animated-analytics-icon')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '20')
    expect(svg).toHaveAttribute('height', '20')

    const barsGroup = container.querySelector('.analytics-bars')
    const bars = container.querySelectorAll('.analytics-bar')
    const trendline = container.querySelector('.analytics-trendline')

    expect(barsGroup).toBeInTheDocument()
    expect(bars).toHaveLength(5)
    expect(trendline).toBeInTheDocument()
  })

  it('accepts custom size, strokeWidth, and className', () => {
    const { container } = render(
      <AnimatedAnalytics size={24} strokeWidth={2.5} className="custom-analytics-class" data-testid="analytics-icon" />,
    )
    const svg = container.querySelector('svg.animated-analytics-icon')

    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')
    expect(svg).toHaveAttribute('stroke-width', '2.5')
    expect(svg).toHaveClass('custom-analytics-class')
    expect(svg).toHaveAttribute('data-testid', 'analytics-icon')
  })
})
