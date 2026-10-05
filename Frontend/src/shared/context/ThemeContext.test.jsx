import { act, fireEvent, render, screen } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext, ThemeProvider } from './ThemeContext.jsx'

function ThemeProbe() {
  const { theme, setTheme } = useContext(ThemeContext)

  return (
    <button
      type="button"
      onClick={() => setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))}
    >
      {theme}
    </button>
  )
}

const originalStartViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition')
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')

function configureMotionPreference(reducedMotion, startViewTransition) {
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: startViewTransition,
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: reducedMotion })),
  })
}

function restoreProperty(target, property, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
    return
  }

  Reflect.deleteProperty(target, property)
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    restoreProperty(document, 'startViewTransition', originalStartViewTransition)
    restoreProperty(window, 'matchMedia', originalMatchMedia)
  })

  it('updates the theme inside a supported view transition', () => {
    const startViewTransition = vi.fn((updateTheme) => updateTheme())
    configureMotionPreference(false, startViewTransition)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(startViewTransition).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'light' }))

    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('iot_monitoring_theme')).toBe('dark')
  })

  it('updates immediately when reduced motion is preferred', () => {
    const startViewTransition = vi.fn((updateTheme) => updateTheme())
    configureMotionPreference(true, startViewTransition)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'light' }))

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('keeps the latest theme when view transition updates overlap', () => {
    const updates = []
    const startViewTransition = vi.fn((updateTheme) => updates.push(updateTheme))
    configureMotionPreference(false, startViewTransition)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    act(() => updates[1]())
    act(() => updates[0]())

    expect(startViewTransition).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'light' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })
})
