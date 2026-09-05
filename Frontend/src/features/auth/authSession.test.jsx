import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiError } from '../../shared/errors/apiError.js'
import { notifyUnauthorized, setUnauthorizedHandler } from '../../shared/errors/unauthorizedSession.js'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { AuthProvider } from './authSession.jsx'

vi.mock('./authService.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../../shared/services/apiClient.js', () => ({
  apiRequest: vi.fn(),
  API_BASE_URL: 'http://localhost:3000',
}))

vi.mock('../../shared/services/sessionRefresh.js', () => ({
  endSessionAcrossTabs: vi.fn(),
  setSessionRefresher: vi.fn(),
  refreshSessionOnce: vi.fn(),
}))

import { apiRequest } from '../../shared/services/apiClient.js'
import { refreshSessionOnce, setSessionRefresher } from '../../shared/services/sessionRefresh.js'
import { login as loginRequest, logout as logoutRequest } from './authService.js'

let registeredRefresher = null

function SessionProbe() {
  const auth = useAuth()

  return (
    <div>
      <span>{auth.isAuthenticated ? 'authenticated' : 'signed-out'}</span>
      <span>{auth.isRestoring ? 'restoring' : 'settled'}</span>
      <span>{auth.sessionExpired ? 'session-expired' : 'session-current'}</span>
      <span>{auth.token ?? 'no-token'}</span>
      <button type="button" onClick={() => auth.login({ username: 'a', password: 'b' })}>do-login</button>
      <button type="button" onClick={() => auth.logout()}>do-logout</button>
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

describe('AuthProvider memory-only sessions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    refreshSessionOnce.mockReset()
    setSessionRefresher.mockReset()
    apiRequest.mockReset()
    loginRequest.mockReset()
    logoutRequest.mockReset()
    registeredRefresher = null

    // The mocked single-flight helper delegates to whatever refresher the
    // provider registers, so restore/refresh flows run real provider logic.
    setSessionRefresher.mockImplementation((refresher) => {
      registeredRefresher = refresher
    })
    refreshSessionOnce.mockImplementation(() => (
      registeredRefresher ? registeredRefresher() : Promise.resolve(null)
    ))
  })

  afterEach(() => {
    setUnauthorizedHandler(null, null)
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('restores the session silently when a refresh cookie is valid', async () => {
    apiRequest.mockResolvedValue({
      token: 'restored-token',
      user: { id: 'user-1', name: 'Admin', role: 'Admin' },
    })

    renderProvider()

    await waitFor(() => expect(screen.getByText('settled')).toBeInTheDocument())
    expect(apiRequest).toHaveBeenCalledWith('/api/auth/refresh', {
      method: 'POST',
      fallbackError: 'Your session has expired.',
    })
    expect(screen.getByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('restored-token')).toBeInTheDocument()
    expect(screen.getByText('session-current')).toBeInTheDocument()
  })

  it('ends up signed out without an expiry banner when no refresh cookie exists', async () => {
    apiRequest.mockRejectedValue(
      createApiError('Missing refresh token.', 401, null, 'UNAUTHENTICATED'),
    )

    renderProvider()

    await waitFor(() => expect(screen.getByText('settled')).toBeInTheDocument())
    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(screen.getByText('session-current')).toBeInTheDocument()
  })

  it('marks the session expired when the refresh token was revoked or reused', async () => {
    apiRequest.mockRejectedValue(
      createApiError('Session expired.', 401, null, 'INVALID_REFRESH_TOKEN'),
    )

    renderProvider()

    await waitFor(() => expect(screen.getByText('settled')).toBeInTheDocument())
    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(screen.getByText('session-expired')).toBeInTheDocument()
  })

  it('stores login results in memory only', async () => {
    apiRequest.mockRejectedValue(
      createApiError('Missing refresh token.', 401, null, 'UNAUTHENTICATED'),
    )
    loginRequest.mockResolvedValue({ token: 'fresh-token', user: { id: 'user-1', name: 'Admin' } })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    renderProvider()
    await waitFor(() => expect(screen.getByText('settled')).toBeInTheDocument())

    await act(async () => {
      screen.getByText('do-login').click()
    })

    expect(screen.getByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('fresh-token')).toBeInTheDocument()
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('iot_monitoring_auth')).toBeNull()
  })

  it('logout clears the session and calls the backend endpoint', async () => {
    apiRequest.mockImplementation((path) => {
      if (path === '/api/auth/refresh') {
        return Promise.resolve({ token: 'live-token', user: { id: 'user-1', name: 'Admin' } })
      }

      return Promise.resolve({ loggedOut: true })
    })

    renderProvider()
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())

    await act(async () => {
      screen.getByText('do-logout').click()
    })

    expect(logoutRequest).toHaveBeenCalledTimes(1)
    expect(screen.getByText('signed-out')).toBeInTheDocument()
  })

  it('clears local auth before a slow logout request settles', async () => {
    let resolveLogout
    apiRequest.mockResolvedValue({
      token: 'live-token',
      user: { id: 'user-1', name: 'Admin' },
    })
    logoutRequest.mockImplementation(() => new Promise((resolve) => {
      resolveLogout = resolve
    }))

    renderProvider()
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())

    act(() => {
      screen.getByText('do-logout').click()
    })

    expect(screen.getByText('signed-out')).toBeInTheDocument()
    resolveLogout()
  })

  it('clears a matching protected session once and exposes expiry state', async () => {
    apiRequest.mockResolvedValue({
      token: 'stored-token',
      user: { id: 'user-1', name: 'Admin', role: 'Admin' },
    })
    renderProvider()
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())

    act(() => {
      const error = createApiError('Invalid or expired token.', 401, null, 'UNAUTHENTICATED')
      notifyUnauthorized(error, { token: 'stored-token', path: '/api/reports/summary' })
      notifyUnauthorized(error, { token: 'stored-token', path: '/api/alerts' })
    })

    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(screen.getByText('session-expired')).toBeInTheDocument()
  })

  it('keeps the active session for a different token or a forbidden response', async () => {
    apiRequest.mockResolvedValue({
      token: 'stored-token',
      user: { id: 'user-1', name: 'Admin', role: 'Admin' },
    })
    renderProvider()
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())

    act(() => {
      notifyUnauthorized(createApiError('Expired.', 401), { token: 'older-token', path: '/api/reports' })
      notifyUnauthorized(createApiError('Login failed.', 401), { path: '/api/auth/login' })
      notifyUnauthorized(createApiError('Forbidden.', 403), { token: 'stored-token', path: '/api/users' })
    })

    expect(screen.getByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('session-current')).toBeInTheDocument()
  })
})
