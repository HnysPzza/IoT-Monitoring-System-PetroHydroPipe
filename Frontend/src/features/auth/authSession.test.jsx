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

const sessionGeneration = vi.hoisted(() => ({ value: 0 }))

vi.mock('../../shared/services/sessionRefresh.js', () => ({
  withSessionLock: (operation) => operation(),
  beginSessionChange: () => ++sessionGeneration.value,
  getSessionGeneration: () => sessionGeneration.value,
  setCurrentSession: vi.fn(),
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
      <span>{'sessionExpired' in auth ? 'has-legacy-expiry-prop' : 'clean-auth-context'}</span>
      <span>{auth.token ?? 'no-token'}</span>
      <span>{auth.sessionError ? `session-error-${auth.sessionError.status}` : 'no-session-error'}</span>
      <button type="button" onClick={() => auth.retrySessionRestore()}>do-retry-restore</button>
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
    setSessionRefresher.mockImplementation((refresher, handler) => {
      registeredRefresher = refresher && (async () => {
        const payload = await refresher()
        if (payload) handler(payload)
        return payload
      })
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
    expect(screen.getByText('clean-auth-context')).toBeInTheDocument()
  })

  it('ends up signed out cleanly when no refresh cookie exists or when refresh fails', async () => {
    apiRequest.mockRejectedValue(
      createApiError('Missing refresh token.', 401, null, 'UNAUTHENTICATED'),
    )

    renderProvider()

    await waitFor(() => expect(screen.getByText('settled')).toBeInTheDocument())
    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(screen.getByText('clean-auth-context')).toBeInTheDocument()
  })

  it('exposes a server error instead of a silent sign-out when the restore request fails with 500', async () => {
    apiRequest.mockRejectedValueOnce(
      createApiError('Unexpected server error.', 500, null, 'REFRESH_QUERY_FAILED'),
    )

    renderProvider()

    await waitFor(() => expect(screen.getByText('settled')).toBeInTheDocument())
    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(screen.getByText('session-error-500')).toBeInTheDocument()

    apiRequest.mockResolvedValueOnce({ token: 'recovered-token', user: { id: 'user-1', role: 'Admin' } })
    await act(async () => {
      screen.getByText('do-retry-restore').click()
    })

    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())
    expect(screen.getByText('recovered-token')).toBeInTheDocument()
    expect(screen.getByText('no-session-error')).toBeInTheDocument()
    expect(screen.getByText('settled')).toBeInTheDocument()
  })

  it.each([
    createApiError('Missing refresh token.', 401, null, 'UNAUTHENTICATED'),
    createApiError('Offline.', 0, null, 'NETWORK_ERROR'),
  ])('does not report a server error when restore fails with $code', async (error) => {
    apiRequest.mockRejectedValue(error)

    renderProvider()

    await waitFor(() => expect(screen.getByText('settled')).toBeInTheDocument())
    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(screen.getByText('no-session-error')).toBeInTheDocument()
  })

  it('keeps the active session when a background refresh fails with a server error', async () => {
    apiRequest.mockResolvedValueOnce({ token: 'live-token', user: { id: 'user-1', role: 'Admin' } })
    renderProvider()
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())

    apiRequest.mockRejectedValueOnce(createApiError('Unexpected server error.', 500, null, 'REFRESH_QUERY_FAILED'))
    await act(async () => {
      await expect(registeredRefresher()).rejects.toMatchObject({ status: 500 })
    })

    expect(screen.getByText('authenticated')).toBeInTheDocument()
    expect(screen.getByText('live-token')).toBeInTheDocument()
    expect(screen.getByText('no-session-error')).toBeInTheDocument()
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

  it.each(['resolve', 'reject'])('ignores an older restore that later %ss after login', async (outcome) => {
    let resolveRestore
    let rejectRestore
    apiRequest.mockReturnValue(new Promise((resolve, reject) => {
      resolveRestore = resolve
      rejectRestore = reject
    }))
    loginRequest.mockResolvedValue({ token: 'new-login', user: { id: 'new-user' } })
    renderProvider()
    await act(async () => { screen.getByText('do-login').click() })
    expect(screen.getByText('new-login')).toBeInTheDocument()
    await act(async () => {
      if (outcome === 'resolve') resolveRestore({ token: 'old-restore', user: { id: 'old-user' } })
      else rejectRestore(createApiError('Expired', 401))
    })
    expect(screen.getByText('new-login')).toBeInTheDocument()
    expect(screen.getByText('authenticated')).toBeInTheDocument()
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

  it('clears a matching protected session once when notified of an unauthorized response', async () => {
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
    expect(screen.getByText('no-token')).toBeInTheDocument()
  })

  it('handles a replacement-token failure before React commits the refreshed state', async () => {
    apiRequest.mockResolvedValue({ token: 'original', user: { id: 'user-1' } })
    renderProvider()
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())
    apiRequest.mockResolvedValue({ token: 'replacement', user: { id: 'user-1' } })
    await act(async () => {
      await registeredRefresher()
      notifyUnauthorized(createApiError('Expired.', 401), { token: 'replacement', path: '/api/alerts' })
    })
    expect(screen.getByText('signed-out')).toBeInTheDocument()
    expect(screen.getByText('no-token')).toBeInTheDocument()
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
    expect(screen.getByText('stored-token')).toBeInTheDocument()
  })
})
