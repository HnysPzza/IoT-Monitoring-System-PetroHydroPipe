import { render, screen } from '@testing-library/react'
import Status from './Status.jsx'

it('shows readable labels with consistent status tones', () => {
  render(<><Status>Running</Status><Status>Idle</Status><Status>Expired</Status><Status>Complete</Status></>)

  expect(screen.getByText('Running').firstChild).toHaveClass('status-dot-active')
  expect(screen.getByText('Idle').firstChild).toHaveClass('status-dot-idle')
  expect(screen.getByText('Expired')).toHaveClass('status-danger')
  expect(screen.getByText('Complete').firstChild).toHaveClass('status-dot-neutral')
})
