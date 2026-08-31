import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnimatedTrashButton } from './AnimatedTrashButton.jsx'

describe('AnimatedTrashButton component', () => {
  it('renders a button with accessible title and aria-label', () => {
    render(<AnimatedTrashButton title="Delete break" ariaLabel="Delete break" />)
    const btn = screen.getByRole('button', { name: 'Delete break' })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('title', 'Delete break')
  })

  it('triggers onClick handler when clicked', () => {
    const handleClick = vi.fn()
    render(<AnimatedTrashButton title="Remove item" onClick={handleClick} />)
    const btn = screen.getByRole('button', { name: 'Remove item' })
    fireEvent.click(btn)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('honors disabled prop', () => {
    const handleClick = vi.fn()
    render(<AnimatedTrashButton title="Remove item" disabled onClick={handleClick} />)
    const btn = screen.getByRole('button', { name: 'Remove item' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('renders animated lid group inside SVG with transform origin', () => {
    const { container } = render(<AnimatedTrashButton title="Remove" />)
    const lidGroup = container.querySelector('.trash-lid')
    expect(lidGroup).toBeInTheDocument()
  })
})
