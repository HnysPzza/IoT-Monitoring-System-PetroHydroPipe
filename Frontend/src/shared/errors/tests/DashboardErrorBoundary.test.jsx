import { lazy, Suspense } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import DashboardErrorBoundary from '../DashboardErrorBoundary.jsx'

function ThrowError({ shouldThrow = true }) {
  if (shouldThrow) throw new Error('Sensitive database connection detail')
  return <p>Dashboard content restored</p>
}

describe('DashboardErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a focused accessible recovery screen without raw error details and reloads on retry', async () => {
    const user = userEvent.setup()
    const reloadPage = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithAuth(
      <DashboardErrorBoundary resetKey="/dashboard/reports" reloadPage={reloadPage}>
        <ThrowError />
      </DashboardErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveFocus()
    expect(screen.getByText('INTERNAL SERVER ERROR')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /something went wrong on our end\./i })).toBeInTheDocument()
    expect(screen.queryByText(/Sensitive database connection detail/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/dashboard')

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('resets the captured error when the route reset key changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = renderWithAuth(
      <DashboardErrorBoundary resetKey="/dashboard/reports">
        <ThrowError />
      </DashboardErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    view.rerender(
      <DashboardErrorBoundary resetKey="/dashboard/live">
        <ThrowError shouldThrow={false} />
      </DashboardErrorBoundary>,
    )

    expect(await screen.findByText('Dashboard content restored')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the captured error when clicking Back to dashboard on the same route', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true

    function RecoverableSection() {
      if (shouldThrow) throw new Error('overview render failure')
      return <p>Dashboard overview recovered</p>
    }

    renderWithAuth(
      <DashboardErrorBoundary resetKey="/dashboard">
        <RecoverableSection />
      </DashboardErrorBoundary>,
      { route: '/dashboard' },
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    shouldThrow = false

    await user.click(screen.getByRole('link', { name: /back to dashboard/i }))

    expect(await screen.findByText('Dashboard overview recovered')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('handles a rejected lazy dashboard import without exposing rejection details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const RejectedDashboardSection = lazy(() => Promise.reject(new Error('sensitive chunk detail')))

    renderWithAuth(
      <DashboardErrorBoundary resetKey="/dashboard/audit">
        <Suspense fallback={<p>Loading dashboard section</p>}>
          <RejectedDashboardSection />
        </Suspense>
      </DashboardErrorBoundary>,
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /something went wrong on our end\./i })).toBeInTheDocument()
    expect(screen.queryByText(/sensitive chunk detail/i)).not.toBeInTheDocument()
  })
})
