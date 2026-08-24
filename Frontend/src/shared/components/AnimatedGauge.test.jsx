import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnimatedGauge } from './AnimatedGauge.jsx'

describe('AnimatedGauge', () => {
  it('renders gauge SVG with default size, gauge-dial and gauge-needle elements', () => {
    const { container } = render(<AnimatedGauge />)
    const svg = container.querySelector('svg.animated-gauge-icon')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '20')
    expect(svg).toHaveAttribute('height', '20')

    const dial = container.querySelector('.gauge-dial')
    const needle = container.querySelector('.gauge-needle')

    expect(dial).toBeInTheDocument()
    expect(needle).toBeInTheDocument()
    expect(needle).toHaveStyle({ transformOrigin: '12px 14px' })
  })

  it('accepts custom size, strokeWidth, and custom className', () => {
    const { container } = render(
      <AnimatedGauge size={24} strokeWidth={3} className="custom-test-class" data-testid="custom-gauge" />,
    )
    const svg = container.querySelector('svg.animated-gauge-icon')

    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')
    expect(svg).toHaveAttribute('stroke-width', '3')
    expect(svg).toHaveClass('animated-gauge-icon')
    expect(svg).toHaveClass('custom-test-class')
    expect(svg).toHaveAttribute('data-testid', 'custom-gauge')
  })
})
