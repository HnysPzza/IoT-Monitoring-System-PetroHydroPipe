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
})
