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

  it('keeps the expired-session message visible and returns to the safe intended route', async () => {
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
          state: {
            from: '/dashboard/reports?type=weekly#rows',
            sessionExpired: true,
          },
        },
      },
    )

    const expiryMessage = screen.getByRole('alert')
    expect(expiryMessage).toHaveTextContent('Your session expired. Sign in again to continue.')

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/^password$/i, { selector: 'input' }), 'password123')
    expect(expiryMessage).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('heading', { name: 'Reports restored' }, { timeout: 1000 })).toBeInTheDocument()
  })
})
