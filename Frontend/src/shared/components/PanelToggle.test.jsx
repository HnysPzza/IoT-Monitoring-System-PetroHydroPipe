import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { PanelToggle } from './PanelToggle.jsx'

describe('PanelToggle component', () => {
  it('renders with open navigation label by default when closed', () => {
    render(<PanelToggle isOpen={false} />)
    const button = screen.getByRole('button', { name: /open navigation/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveClass('is-pointing-right')
  })

  it('renders with close navigation label when open', () => {
    render(<PanelToggle isOpen={true} />)
    const button = screen.getByRole('button', { name: /close navigation/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveClass('is-pointing-left')
  })

  it('renders with collapse sidebar label when sidebar is expanded', () => {
    render(<PanelToggle isCollapsed={false} />)
    const button = screen.getByRole('button', { name: /collapse sidebar/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveClass('is-pointing-left')
  })

  it('renders with expand sidebar label when sidebar is collapsed', () => {
    render(<PanelToggle isCollapsed={true} />)
    const button = screen.getByRole('button', { name: /expand sidebar/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveClass('is-pointing-right')
  })

  it('forwards ref correctly to the HTMLButtonElement', () => {
    const ref = createRef()
    render(<PanelToggle ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('handles click events properly', () => {
    const handleClick = vi.fn()
    render(<PanelToggle onClick={handleClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
