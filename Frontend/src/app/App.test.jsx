import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../features/auth/authSession.jsx'
import { ThemeContext } from '../shared/context/ThemeContext.jsx'
import { renderWithAuth } from '../test/renderWithAuth.jsx'
import App, { DashboardRouteBoundary, ProtectedRoute } from './App.jsx'

function LoginDestination() {
  const location = useLocation()
  return <span>{JSON.stringify({ search: location.search, state: location.state })}</span>
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

  it('renders the full-page 401 UnauthorizedPage and preserves the intended dashboard path when unauthenticated', async () => {
    const user = userEvent.setup()

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
        authValue: { isAuthenticated: false, isRestoring: false, token: null, user: null },
        route: '/dashboard/reports?type=weekly#rows',
      },
    )

    expect(screen.getByText('SIGN-IN REQUIRED')).toBeInTheDocument()
    expect(screen.getByText('401')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /please sign in again/i })).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()

    const signInLink = screen.getByRole('link', { name: /sign in/i })
    expect(signInLink).toHaveAttribute('href', '/login?next=%2Fdashboard%2Freports%3Ftype%3Dweekly%23rows')

    await user.click(signInLink)
    expect(
      await screen.findByText(
        '{"search":"?next=%2Fdashboard%2Freports%3Ftype%3Dweekly%23rows","state":{"from":"/dashboard/reports?type=weekly#rows"}}',
      ),
    ).toBeInTheDocument()
  })

  it('renders the full-page 500 ServerErrorPage instead of 401 when session restore fails with a 500 error', async () => {
    const user = userEvent.setup()
    const retrySessionRestore = vi.fn()

    renderWithAuth(
      <Routes>
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
        authValue: {
          isAuthenticated: false,
          isRestoring: false,
          token: null,
          user: null,
          sessionError: { status: 500, code: 'REFRESH_QUERY_FAILED', message: 'Unexpected server error.' },
          retrySessionRestore,
        },
        route: '/dashboard/reports',
      },
    )

    expect(screen.getByText('INTERNAL SERVER ERROR')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /something went wrong on our end\./i })).toBeInTheDocument()
    expect(screen.queryByText('SIGN-IN REQUIRED')).not.toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(retrySessionRestore).toHaveBeenCalledTimes(1)
  })

  it('renders a recoverable connection error instead of 401 when session restore fails with status 0 network drop', async () => {
    const user = userEvent.setup()
    const retrySessionRestore = vi.fn()

    renderWithAuth(
      <Routes>
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
        authValue: {
          isAuthenticated: false,
          isRestoring: false,
          token: null,
          user: null,
          sessionError: { status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the server.' },
          retrySessionRestore,
        },
        route: '/dashboard/reports',
      },
    )

    expect(screen.getByText('CONNECTION UNAVAILABLE')).toBeInTheDocument()
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /unable to reach the server\./i })).toBeInTheDocument()
    expect(screen.queryByText('SIGN-IN REQUIRED')).not.toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(retrySessionRestore).toHaveBeenCalledTimes(1)
  })

  it('renders a recoverable rate-limit error instead of 401 or 500 when session restore hits 429', async () => {
    const user = userEvent.setup()
    const retrySessionRestore = vi.fn()

    renderWithAuth(
      <Routes>
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
        authValue: {
          isAuthenticated: false,
          isRestoring: false,
          token: null,
          user: null,
          sessionError: { status: 429, code: 'RATE_LIMITED', message: 'Too many requests.' },
          retrySessionRestore,
        },
        route: '/dashboard/reports',
      },
    )

    expect(screen.getByText('TOO MANY REQUESTS')).toBeInTheDocument()
    expect(screen.getByText('429')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /too many requests right now\./i })).toBeInTheDocument()
    expect(screen.queryByText('SIGN-IN REQUIRED')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(retrySessionRestore).toHaveBeenCalledTimes(1)
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

    expect(screen.getByRole('heading', { name: /something went wrong on our end\./i })).toBeInTheDocument()
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

  it('redirects authenticated users away from /change-password to /dashboard when mustChangePassword is false', async () => {
    renderWithAuth(<App />, {
      authValue: {
        isAuthenticated: true,
        isRestoring: false,
        token: 'tok',
        user: { id: 'u1', role: 'Admin', mustChangePassword: false },
      },
      route: '/change-password',
    })

    expect(screen.queryByRole('heading', { name: 'Change password' })).not.toBeInTheDocument()
  })

  it('renders the full-page 404 NotFoundPage for unknown top-level and nested dashboard routes', async () => {
    renderWithAuth(<App />, {
      authValue: { isAuthenticated: true, isRestoring: false, token: 'tok', user: { id: 'u1', role: 'Admin' } },
      route: '/dashboard/unknown-section',
    })

    expect(await screen.findByRole('heading', { name: /this page isn’t here/i })).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/dashboard')
  })

  it('redirects /change-password to /login with password-updated status after submitting without flashing 401', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ completed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    function StatefulAuthHarness() {
      const [auth, setAuth] = useState({
        token: 'tok',
        user: { id: 'u1', role: 'Admin', mustChangePassword: true },
      })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

      return (
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{
              token: auth?.token || null,
              user: auth?.user || null,
              isAuthenticated: Boolean(auth?.token),
              isRestoring: false,
              sessionError: null,
              login: vi.fn(),
              logout: async () => {
                setAuth(null)
              },
            }}
          >
            <ThemeContext.Provider value={{ theme: 'light', setTheme: () => {} }}>
              <MemoryRouter initialEntries={['/change-password']}>
                <App />
              </MemoryRouter>
            </ThemeContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    }

    render(<StatefulAuthHarness />)

    await user.type(await screen.findByLabelText('Current password'), 'temporary-password')
    await user.type(screen.getByLabelText('New password'), 'Replacement-password1!')
    await user.type(screen.getByLabelText('Confirm password'), 'Replacement-password1!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/password updated.*sign in with your new password/i)
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.queryByText('SIGN-IN REQUIRED')).not.toBeInTheDocument()
    expect(screen.queryByText('401')).not.toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('redirects /change-password to /login when clicking Sign out without flashing 401', async () => {
    const user = userEvent.setup()

    function StatefulSignOutHarness() {
      const [auth, setAuth] = useState({
        token: 'tok',
        user: { id: 'u1', role: 'Admin', mustChangePassword: true },
      })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

      return (
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{
              token: auth?.token || null,
              user: auth?.user || null,
              isAuthenticated: Boolean(auth?.token),
              isRestoring: false,
              sessionError: null,
              login: vi.fn(),
              logout: async () => {
                setAuth(null)
              },
            }}
          >
            <ThemeContext.Provider value={{ theme: 'light', setTheme: () => {} }}>
              <MemoryRouter initialEntries={['/change-password']}>
                <App />
              </MemoryRouter>
            </ThemeContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    }

    render(<StatefulSignOutHarness />)

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.queryByText('SIGN-IN REQUIRED')).not.toBeInTheDocument()
    expect(screen.queryByText('401')).not.toBeInTheDocument()
  })
})
