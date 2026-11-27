import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import RefreshStatus from './RefreshStatus.jsx'

it('keeps the status space while refresh and filter messages change', () => {
  const props = { message: 'Refreshing...', placeholderMessage: 'Loading filters; previous results remain visible.' }
  const { container, rerender } = render(<RefreshStatus {...props} active={false} />)
  const slot = container.querySelector('.refresh-status-slot')
  expect(slot).toHaveAttribute('data-message', props.message)
  expect(slot).toHaveAttribute('data-placeholder', props.placeholderMessage)
  rerender(<RefreshStatus {...props} active />)
  expect(screen.getByRole('status')).toHaveTextContent(props.message)
  expect(container.querySelector('.refresh-status-slot')).toBe(slot)
  rerender(<RefreshStatus {...props} active isPlaceholder />)
  expect(screen.getByRole('status')).toHaveTextContent(props.placeholderMessage)
  expect(container.querySelector('.refresh-status-slot')).toBe(slot)
  rerender(<RefreshStatus {...props} active={false} />)
  expect(container.querySelector('.refresh-status-slot')).toBe(slot)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
