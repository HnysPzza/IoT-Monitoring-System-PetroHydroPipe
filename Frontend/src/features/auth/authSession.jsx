import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { setUnauthorizedHandler } from '../../shared/errors/unauthorizedSession.js'
import { apiRequest } from '../../shared/services/apiClient.js'
import { beginSessionChange, endSessionAcrossTabs, getSessionGeneration, refreshSessionOnce, setCurrentSession, setSessionRefresher, withSessionLock } from '../../shared/services/sessionRefresh.js'
import { createApiError } from '../../shared/errors/apiError.js'
import { login as loginRequest, logout as logoutRequest } from './authService.js'

const LEGACY_STORAGE_KEY = 'iot_monitoring_auth'

// 401 codes that mean the refresh cookie itself is dead (revoked, reused, or
// unknown) versus a missing cookie on a first visit.
const EXPIRED_REFRESH_CODES = new Set(['INVALID_REFRESH_TOKEN', 'REFRESH_TOKEN_REUSED'])

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  const expiredTokenRef = useRef(null)
  const explicitlyLoggedOutRef = useRef(false)

  function applySession(payload) {
    expiredTokenRef.current = null
    setSessionExpired(false)
    setAuth(payload)
  }

  function clearSession() {
    expiredTokenRef.current = null
    setSessionExpired(false)
    setAuth(null)
  }

  // Sessions live in React state only; clear any pre-migration localStorage token.
  useEffect(() => {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  }, [])

  // The single-flight refresher backs apiClient retries and SSE recovery.
  useLayoutEffect(() => {
    setSessionRefresher(async () => {
      const generation = getSessionGeneration()
      try {
        const payload = await apiRequest('/api/auth/refresh', {
          method: 'POST',
          fallbackError: 'Your session has expired.',
        })

        if (!payload?.token || explicitlyLoggedOutRef.current || generation !== getSessionGeneration()) return null

        return payload
      } catch (error) {
        if (explicitlyLoggedOutRef.current || generation !== getSessionGeneration()) return null

        setAuth(null)
        if (EXPIRED_REFRESH_CODES.has(error?.code)) {
          setSessionExpired(true)
        }
        return null
      }
    }, (payload) => {
      if (!payload) {
        explicitlyLoggedOutRef.current = true
        clearSession()
        return
      }

      if (!explicitlyLoggedOutRef.current) applySession(payload)
    })

    return () => setSessionRefresher(null)
  }, [])

  // Silent restore: a valid HttpOnly refresh cookie brings the session back
  // after a page reload without ever exposing a token to storage.
  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      try {
        await refreshSessionOnce()
      } catch {
        // Session restore must never block the login page on errors.
      } finally {
        if (!cancelled) setIsRestoring(false)
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    if (!auth?.token) {
      return setUnauthorizedHandler(null, null)
    }

    const activeToken = auth.token

    return setUnauthorizedHandler(activeToken, () => {
      if (expiredTokenRef.current === activeToken) return

      expiredTokenRef.current = activeToken
      setAuth(null)
      setSessionExpired(true)
    })
  }, [auth?.token])

  async function login(credentials) {
    const generation = beginSessionChange()
    const nextAuth = await withSessionLock(() => loginRequest(credentials))
    if (generation !== getSessionGeneration()) throw createApiError('Sign-in was cancelled.', 0, null, 'SESSION_CHANGED')
    explicitlyLoggedOutRef.current = false
    setCurrentSession(nextAuth)
    applySession(nextAuth)
    return nextAuth
  }

  async function logout() {
    explicitlyLoggedOutRef.current = true
    clearSession()
    endSessionAcrossTabs()

    try {
      await withSessionLock(logoutRequest)
    } catch {
      // Clear the local session even if the backend call fails.
    }
  }

  const value = useMemo(
    () => ({
      token: auth?.token || null,
      user: auth?.user || null,
      isAuthenticated: Boolean(auth?.token),
      isRestoring,
      sessionExpired,
      login,
      logout,
    }),
    [auth, isRestoring, sessionExpired],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
