import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NotebookDot } from './NotebookDot.jsx'

describe('NotebookDot', () => {
  it('renders notebook-dot SVG with default dimensions and correct paths', () => {
    const { container } = render(<NotebookDot />)
    const svg = container.querySelector('svg.lucide-notebook-dot')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '20')
    expect(svg).toHaveAttribute('height', '20')
    expect(svg).toHaveAttribute('stroke-width', '2')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')

    const paths = container.querySelectorAll('path')
    expect(paths).toHaveLength(6)

    const circle = container.querySelector('circle')
    expect(circle).toBeInTheDocument()
    expect(circle).toHaveAttribute('cx', '18')
    expect(circle).toHaveAttribute('cy', '5')
    expect(circle).toHaveAttribute('r', '3')
  })

  it('accepts custom size, strokeWidth, and className', () => {
    const { container } = render(
      <NotebookDot size={24} strokeWidth={1.75} className="custom-notebook-dot" data-testid="custom-dot" />,
    )
    const svg = container.querySelector('svg.lucide-notebook-dot')

    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('height', '24')
    expect(svg).toHaveAttribute('stroke-width', '1.75')
    expect(svg).toHaveClass('custom-notebook-dot')
    expect(svg).toHaveAttribute('data-testid', 'custom-dot')
  })
})
