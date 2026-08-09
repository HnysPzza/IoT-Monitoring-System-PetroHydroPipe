import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../test/renderWithAuth.jsx'
import { DashboardRouteBoundary, ProtectedRoute } from './App.jsx'

function LoginDestination() {
  const location = useLocation()
  return <span>{JSON.stringify(location.state)}</span>
}

function RouteBoundaryHarness() {
  const location = useLocation()
  const navigate = useNavigate()

  function PathSensitiveSection() {
    if (location.pathname === '/dashboard/reports') throw new Error('private route failure')
    return <p>Live section restored</p>
  }

  return (
    <>
      <button type="button" onClick={() => navigate('/dashboard/live')}>Change dashboard route</button>
      <DashboardRouteBoundary>
        <PathSensitiveSection />
      </DashboardRouteBoundary>
    </>
  )
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves the current safe dashboard pathname, query, and hash', async () => {
    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginDestination />} />
        <Route
          path="/dashboard/reports"
          element={(
            <ProtectedRoute>
              <span>Protected content</span>
            </ProtectedRoute>
          )}
        />
      </Routes>,
      {
        authValue: { isAuthenticated: false, sessionExpired: true, token: null, user: null },
        route: '/dashboard/reports?type=weekly#rows',
      },
    )

    expect(await screen.findByText('{"from":"/dashboard/reports?type=weekly#rows","sessionExpired":true}')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('places dashboard descendants inside the route-aware recovery boundary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function BrokenDashboardSection() {
      throw new Error('private render failure')
    }

    renderWithAuth(
      <DashboardRouteBoundary>
        <BrokenDashboardSection />
      </DashboardRouteBoundary>,
      { route: '/dashboard/reports' },
    )

    expect(screen.getByRole('heading', { name: 'This dashboard section could not load' })).toBeInTheDocument()
    expect(screen.queryByText('private render failure')).not.toBeInTheDocument()
  })

  it('resets the dashboard recovery boundary when the location pathname changes', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderWithAuth(<RouteBoundaryHarness />, { route: '/dashboard/reports' })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Change dashboard route' }))

    expect(await screen.findByText('Live section restored')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
