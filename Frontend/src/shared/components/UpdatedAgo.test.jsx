import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import UpdatedAgo from './UpdatedAgo.jsx'

afterEach(() => vi.useRealTimers())

it('updates the age while a stale snapshot remains visible', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
  render(<UpdatedAgo updatedAt={new Date('2026-01-01T00:00:00Z')} />)
  expect(screen.getByText('10 seconds ago')).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(10000))
  expect(screen.getByText('20 seconds ago')).toBeInTheDocument()
})
