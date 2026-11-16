import { render, screen } from '@testing-library/react'
import Status from './Status.jsx'

it('shows readable labels with distinct running, idle, fault, danger, offline, and neutral tones', () => {
  render(
    <>
      <Status>Running</Status>
      <Status>Idle</Status>
      <Status>Fault</Status>
      <Status tone="danger">Downtime fault</Status>
      <Status>Last: Run</Status>
      <Status>Expired</Status>
      <Status>Complete</Status>
    </>,
  )

  expect(screen.getByText('Running').firstChild).toHaveClass('status-dot-active')
  expect(screen.getByText('Idle').firstChild).toHaveClass('status-dot-idle')
  expect(screen.getByText('Fault')).toHaveClass('status-fault')
  expect(screen.getByText('Fault')).not.toHaveClass('status-danger')
  expect(screen.getByText('Fault').firstChild).toHaveClass('status-dot-fault')
  expect(screen.getByText('Downtime fault')).toHaveClass('status-danger')
  expect(screen.getByText('Last: Run')).toHaveClass('status-offline')
  expect(screen.getByText('Last: Run').firstChild).toHaveClass('status-dot-offline')
  expect(screen.getByText('Expired')).toHaveClass('status-danger')
  expect(screen.getByText('Complete').firstChild).toHaveClass('status-dot-neutral')
})
