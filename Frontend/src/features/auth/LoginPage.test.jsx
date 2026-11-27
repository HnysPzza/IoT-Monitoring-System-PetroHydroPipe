import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../shared/context/ThemeContext.jsx'
import { setUnauthorizedHandler } from '../../shared/errors/unauthorizedSession.js'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { queryClient } from '../../shared/services/queryClient.js'
import { renderWithAuth } from '../../test/renderWithAuth.jsx'
import { AuthProvider } from './authSession.jsx'
import LoginPage from './LoginPage.jsx'

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

describe('LoginPage', () => {
  afterEach(() => {
    queryClient.clear()
    setUnauthorizedHandler(null, null)
    vi.restoreAllMocks()
    restoreProperty(document, 'startViewTransition', originalStartViewTransition)
    restoreProperty(window, 'matchMedia', originalMatchMedia)
  })
  it('does not show an error when untouched auto-focused username loses focus while empty', async () => {
    const user = userEvent.setup()

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login: vi.fn(),
      },
      route: '/login',
    })

    const usernameInput = screen.getByLabelText(/username/i)
    expect(usernameInput).toHaveFocus()
    await user.tab()

    expect(screen.queryByText('Username is required.')).not.toBeInTheDocument()
    expect(usernameInput).toHaveAttribute('aria-invalid', 'false')
  })

  it('shows validation errors without calling login when fields are empty', async () => {
    const user = userEvent.setup()
    const login = vi.fn()

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByText('Username is required.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
    expect(screen.getByLabelText(/username/i)).toHaveFocus()
    expect(login).not.toHaveBeenCalled()
  })

  it('calls login and shows success state for valid credentials', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue({
      token: 'token',
      user: { id: 'user-1', role: 'Admin' },
    })

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'password123' })
    expect(await screen.findByRole('status')).toHaveTextContent(/access granted/i)
  })

  it('returns to the safe ?next= intended route after sign in without showing a redundant session-expired banner', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue({
      token: 'token',
      user: { id: 'user-1', role: 'Admin' },
    })

    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard/reports" element={<h1>Reports restored</h1>} />
      </Routes>,
      {
        authValue: {
          isAuthenticated: false,
          token: null,
          user: null,
          login,
        },
        route: {
          pathname: '/login',
          search: '?next=%2Fdashboard%2Freports%3Ftype%3Dweekly%23rows',
          state: {
            sessionExpired: true,
          },
        },
      },
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: 'Reports restored' }, { timeout: 1000 })).toBeInTheDocument()
  })

  it('displays wrong password message below password field with red border and shake on wrong password', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockRejectedValue(new Error('Invalid username or password.'))

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' })
    await user.type(passwordInput, 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'wrongpassword' })

    const passwordError = await screen.findByRole('alert')
    expect(passwordError).toHaveTextContent('Invalid username or password.')
    expect(passwordError).toHaveAttribute('id', 'password-error')

    const passwordShell = passwordInput.closest('.input-shell')
    expect(passwordShell).toHaveClass('has-error')
    expect(passwordShell).toHaveClass('shake')
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    expect(passwordInput).toHaveAttribute('aria-describedby', 'password-error')
    expect(passwordInput).not.toBeDisabled()
    expect(passwordInput).toHaveFocus()

    await user.type(passwordInput, '1')
    expect(screen.queryByText('Invalid username or password.')).not.toBeInTheDocument()
    expect(passwordShell).not.toHaveClass('shake')
  })

  it('displays non-password server errors in top notice banner without shaking password field', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockRejectedValue(new Error('Database offline. Please try later.'))

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' })
    await user.type(passwordInput, 'validpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    // Top notice banner appears
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Database offline. Please try later.')
    expect(alert).toHaveClass('notice', 'notice-error')

    // Password shell does NOT have error or shake
    const passwordShell = passwordInput.closest('.input-shell')
    expect(passwordShell).not.toHaveClass('has-error')
    expect(passwordShell).not.toHaveClass('shake')
    expect(screen.queryByText('Database offline. Please try later.', { selector: '#password-error' })).not.toBeInTheDocument()
  })

  it('triggers shake on password field when empty password is submitted', async () => {
    const user = userEvent.setup()
    const login = vi.fn()

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' })
    const passwordShell = passwordInput.closest('.input-shell')
    expect(passwordShell).toHaveClass('has-error')
    expect(passwordShell).toHaveClass('shake')
    expect(screen.getByText('Password is required.')).toHaveAttribute('id', 'password-error')
  })

  it('submits short non-empty passwords instead of enforcing a mismatched client length limit', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue({
      token: 'token',
      user: { id: 'user-1', role: 'Admin' },
    })

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'old')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'old' })
  })

  it('shows password-updated confirmation from route state and Managing Director access guidance', () => {
    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login: vi.fn(),
      },
      route: {
        pathname: '/login',
        state: { passwordChanged: true },
      },
    })

    expect(screen.getByRole('heading', { name: 'Sign in to PHP-Monitoring' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/password updated.*sign in with your new password/i)
    expect(screen.getByText(/managing director/i)).toBeInTheDocument()
    expect(screen.queryByText(/SECURED SYSTEM ACCESS/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /administrator login/i })).not.toBeInTheDocument()
  })

  it('keeps non-credential invalid-response errors in top alert banner instead of password field', async () => {
    const user = userEvent.setup()
    const error = Object.assign(
      new Error('The server returned an invalid response. Please try again.'),
      { code: 'MALFORMED_RESPONSE', status: 502 },
    )
    const login = vi.fn().mockRejectedValue(error)

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' })
    await user.type(passwordInput, 'validpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveClass('notice', 'notice-error')
    expect(alert).toHaveTextContent('The server returned an invalid response. Please try again.')
    expect(passwordInput.closest('.input-shell')).not.toHaveClass('has-error')
    expect(passwordInput.closest('.input-shell')).not.toHaveClass('shake')
  })

  it('locks form inputs and ignores duplicate submit while login request is pending', async () => {
    const user = userEvent.setup()
    let finishLogin
    const login = vi.fn(() => new Promise((resolve) => {
      finishLogin = resolve
    }))

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login,
      },
      route: '/login',
    })

    const usernameInput = screen.getByLabelText(/username/i)
    const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' })
    await user.type(usernameInput, 'admin')
    await user.type(passwordInput, 'validpassword')

    const submitButton = screen.getByRole('button', { name: /sign in/i })
    await user.click(submitButton)

    expect(usernameInput).toBeDisabled()
    expect(passwordInput).toBeDisabled()
    expect(screen.getByRole('button', { name: /verifying access/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /verifying access/i }))
    expect(login).toHaveBeenCalledTimes(1)

    finishLogin({ token: 'tok', user: { id: 'u1', role: 'Admin' } })
    expect(await screen.findByRole('status')).toHaveTextContent(/access granted/i)
  })

  it('keeps Caps Lock warning visible when toggling password visibility', async () => {
    const user = userEvent.setup()

    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login: vi.fn(),
      },
      route: '/login',
    })

    const passwordInput = screen.getByLabelText(/^password$/i, { selector: 'input' })
    await user.click(passwordInput)
    await user.keyboard('{CapsLock}')
    expect(screen.getByText('Caps Lock is active.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByText('Caps Lock is active.')).toBeInTheDocument()
  })

  it('renders explicit logo dimensions without noisy brand highlight subtext', () => {
    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login: vi.fn(),
      },
      route: '/login',
    })

    const logo = screen.getByRole('img', { name: 'PetroHydroPipe logo' })
    expect(logo).toHaveAttribute('width', '315')
    expect(logo).toHaveAttribute('height', '172')

    expect(screen.queryByLabelText('Monitoring system highlights')).not.toBeInTheDocument()
    expect(screen.queryByText('Spiral Mill 01 live feed')).not.toBeInTheDocument()
  })

  it('uses a view transition for the post-login redirect when supported and reduced motion is off', async () => {
    const startViewTransition = vi.fn((updateRoute) => updateRoute())
    configureMotionPreference(false, startViewTransition)
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue({
      token: 'token',
      user: { id: 'user-1', role: 'Admin' },
    })

    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<h1>Dashboard ready</h1>} />
      </Routes>,
      {
        authValue: {
          isAuthenticated: false,
          token: null,
          user: null,
          login,
        },
        route: '/login',
      },
    )

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: 'Dashboard ready' }, { timeout: 1000 })).toBeInTheDocument()
    expect(startViewTransition).toHaveBeenCalledTimes(1)
  })

  it('skips view transitions and navigates directly when reduced motion is preferred', async () => {
    const startViewTransition = vi.fn((updateRoute) => updateRoute())
    configureMotionPreference(true, startViewTransition)
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue({
      token: 'token',
      user: { id: 'user-1', role: 'Admin' },
    })

    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<h1>Dashboard ready</h1>} />
      </Routes>,
      {
        authValue: {
          isAuthenticated: false,
          token: null,
          user: null,
          login,
        },
        route: '/login',
      },
    )

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: 'Dashboard ready' }, { timeout: 1000 })).toBeInTheDocument()
    expect(startViewTransition).not.toHaveBeenCalled()
  })

  it('renders a concise sign-in subtitle with natural spaces and no nonbreaking spaces', () => {
    renderWithAuth(<LoginPage />, {
      authValue: {
        isAuthenticated: false,
        token: null,
        user: null,
        login: vi.fn(),
      },
      route: '/login',
    })

    const subtitle = screen.getByText(/Access dashboards for your plant role\./i)
    expect(subtitle.textContent).toBe('Access dashboards for your plant role.')
    expect(subtitle.textContent).not.toContain('\u00A0')
  })

  it('does not commit navigation when unmounted before an async view transition callback executes', async () => {
    let capturedCallback = null
    let dashboardRendered = 0
    const startViewTransition = vi.fn((callback) => {
      capturedCallback = callback
    })
    configureMotionPreference(false, startViewTransition)
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue({
      token: 'token',
      user: { id: 'user-1', role: 'Admin' },
    })

    function DashboardMarker() {
      dashboardRendered += 1
      return <h1>Dashboard ready</h1>
    }

    const { unmount } = renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardMarker />} />
      </Routes>,
      {
        authValue: {
          isAuthenticated: false,
          token: null,
          user: null,
          login,
        },
        route: '/login',
      },
    )

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(startViewTransition).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(typeof capturedCallback).toBe('function')

    unmount()
    act(() => {
      capturedCallback()
    })

    expect(dashboardRendered).toBe(0)
  })

  it('keeps LoginPage mounted through the post-login banner and calls startViewTransition with real AuthProvider', async () => {
    const startViewTransition = vi.fn((updateRoute) => updateRoute())
    configureMotionPreference(false, startViewTransition)
    const user = userEvent.setup()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/auth/refresh')) {
        return new Response(JSON.stringify({ error: { message: 'No active session.' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'real-token',
            user: { id: 'user-1', name: 'Admin', role: 'Admin' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    function RestoredAuthRoutes() {
      const auth = useAuth()
      if (auth.isRestoring) {
        return <p>Restoring...</p>
      }

      return (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<h1>Dashboard ready</h1>} />
        </Routes>
      )
    }

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeContext.Provider value={{ theme: 'light', setTheme: () => {} }}>
          <MemoryRouter initialEntries={['/login']}>
            <AuthProvider>
              <RestoredAuthRoutes />
            </AuthProvider>
          </MemoryRouter>
        </ThemeContext.Provider>
      </QueryClientProvider>,
    )

    await user.type(await screen.findByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'password123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/access granted\. loading dashboard\./i)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Dashboard ready' }, { timeout: 1500 })).toBeInTheDocument()
    expect(startViewTransition).toHaveBeenCalledTimes(1)
  })

  it('redirects directly to /change-password with setup notice when mustChangePassword is true', async () => {
    const startViewTransition = vi.fn((updateRoute) => updateRoute())
    configureMotionPreference(false, startViewTransition)
    const user = userEvent.setup()
    let dashboardRendered = 0
    const login = vi.fn().mockResolvedValue({
      token: 'token',
      user: { id: 'user-1', role: 'Admin', mustChangePassword: true },
    })

    function DashboardMarker() {
      dashboardRendered += 1
      return <h1>Dashboard ready</h1>
    }

    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<h1>Change password route</h1>} />
        <Route path="/dashboard" element={<DashboardMarker />} />
        <Route path="/dashboard/reports" element={<DashboardMarker />} />
      </Routes>,
      {
        authValue: {
          isAuthenticated: false,
          token: null,
          user: null,
          login,
        },
        route: '/login?next=%2Fdashboard%2Freports',
      },
    )

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'temporary123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Password update required. Opening setup.')
    expect(status).not.toHaveTextContent(/loading dashboard/i)
    expect(await screen.findByRole('heading', { name: 'Change password route' }, { timeout: 1000 })).toBeInTheDocument()
    expect(dashboardRendered).toBe(0)
    expect(startViewTransition).toHaveBeenCalledTimes(1)
  })

  it('redirects an already-authenticated session with mustChangePassword directly to /change-password without rendering intended dashboard route', async () => {
    let dashboardRendered = 0

    function DashboardMarker() {
      dashboardRendered += 1
      return <h1>Dashboard ready</h1>
    }

    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<h1>Change password route</h1>} />
        <Route path="/dashboard" element={<DashboardMarker />} />
        <Route path="/dashboard/reports" element={<DashboardMarker />} />
      </Routes>,
      {
        authValue: {
          isAuthenticated: true,
          token: 'token',
          user: { id: 'user-1', role: 'Admin', mustChangePassword: true },
          login: vi.fn(),
        },
        route: '/login?next=%2Fdashboard%2Freports',
      },
    )

    expect(await screen.findByRole('heading', { name: 'Change password route' })).toBeInTheDocument()
    expect(dashboardRendered).toBe(0)
  })

  it('redirects an already-authenticated session without mustChangePassword to the safe ?next= dashboard route', async () => {
    let changePasswordRendered = 0

    function ChangePasswordMarker() {
      changePasswordRendered += 1
      return <h1>Change password route</h1>
    }

    renderWithAuth(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordMarker />} />
        <Route path="/dashboard" element={<h1>Dashboard fallback</h1>} />
        <Route path="/dashboard/reports" element={<h1>Reports ready</h1>} />
      </Routes>,
      {
        authValue: {
          isAuthenticated: true,
          token: 'token',
          user: { id: 'user-1', role: 'Admin', mustChangePassword: false },
          login: vi.fn(),
        },
        route: '/login?next=%2Fdashboard%2Freports',
      },
    )

    expect(await screen.findByRole('heading', { name: 'Reports ready' })).toBeInTheDocument()
    expect(changePasswordRendered).toBe(0)
  })

  it('redirects directly to /change-password without rendering intended dashboard route when AuthProvider silently restores a mustChangePassword session', async () => {
    let resolveRefresh
    let dashboardRendered = 0

    function DashboardMarker() {
      dashboardRendered += 1
      return <h1>Dashboard ready</h1>
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.includes('/api/auth/refresh')) {
        return new Promise((resolve) => {
          resolveRefresh = resolve
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeContext.Provider value={{ theme: 'light', setTheme: () => {} }}>
          <MemoryRouter initialEntries={['/login?next=%2Fdashboard%2Freports']}>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/change-password" element={<h1>Change password route</h1>} />
                <Route path="/dashboard" element={<DashboardMarker />} />
                <Route path="/dashboard/reports" element={<DashboardMarker />} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </ThemeContext.Provider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Sign in to PHP-Monitoring' })).toBeInTheDocument()
    expect(dashboardRendered).toBe(0)

    await act(async () => {
      resolveRefresh(
        new Response(
          JSON.stringify({
            token: 'restored-token',
            user: { id: 'user-1', name: 'Admin', role: 'Admin', mustChangePassword: true },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    })

    expect(await screen.findByRole('heading', { name: 'Change password route' })).toBeInTheDocument()
    expect(dashboardRendered).toBe(0)
  })
})
