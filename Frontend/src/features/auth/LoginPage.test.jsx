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
})
