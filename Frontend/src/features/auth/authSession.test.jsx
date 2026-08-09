import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiError, notifyUnauthorized, setUnauthorizedHandler } from '../../shared/services/apiClient.js'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { AuthProvider } from './authSession.jsx'

vi.mock('./authService.js', () => ({
  login: vi.fn(),
}))

const storedAuth = {
  token: 'stored-token',
  user: { id: 'user-1', name: 'Admin', role: 'Admin' },
}

function SessionProbe() {
  const auth = useAuth()

  return (
    <div>
      <span>{auth.isAuthenticated ? 'authenticated' : 'signed-out'}</span>
      <span>{auth.sessionExpired ? 'session-expired' : 'session-current'}</span>
    </div>
  )
}

function renderProvider() {
  return render(
    <AuthProvider>
      <SessionProbe />
    </AuthProvider>,
  )
}

describe('AuthProvider session expiry', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('iot_monitoring_auth', JSON.stringify(storedAuth))
  })

  afterEach(() => {
    setUnauthorizedHandler(null, null)
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('clears a matching protected session once and exposes expiry state', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    renderProvider()

    act(() => {
      const error = createApiError('Invalid or expired token.', 401, null, 'UNAUTHENTICATED')
      notifyUnauthorized(error, { token: 'stored-token', path: '/api/reports/summary' })
      notifyUnauthorized(error, { token: 'stored-token', path: '/api/alerts' })
    })

    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(window.localStorage.getItem('iot_monitoring_auth')).toBeNull()
    expect(removeItem).toHaveBeenCalledTimes(1)
    expect(screen.getByText('session-expired')).toBeInTheDocument()
  })

  it('keeps the active session for a different token, no token, or a forbidden response', () => {
    renderProvider()

    act(() => {
      notifyUnauthorized(createApiError('Expired.', 401), { token: 'older-token', path: '/api/reports' })
      notifyUnauthorized(createApiError('Login failed.', 401), { path: '/api/auth/login' })
      notifyUnauthorized(createApiError('Forbidden.', 403), { token: 'stored-token', path: '/api/users' })
    })

    expect(screen.getByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('session-current')).toBeInTheDocument()
    expect(window.localStorage.getItem('iot_monitoring_auth')).toBe(JSON.stringify(storedAuth))
  })
})
