import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../test/renderWithAuth.jsx'
import LoginPage from './LoginPage.jsx'

describe('LoginPage', () => {
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
})
