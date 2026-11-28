import { Fragment, createContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { setUnauthorizedHandler } from '../../shared/errors/unauthorizedSession.js'
import { apiRequest } from '../../shared/services/apiClient.js'
import { beginSessionChange, endSessionAcrossTabs, getSessionGeneration, refreshSessionOnce, setCurrentSession, setSessionRefresher, withSessionLock } from '../../shared/services/sessionRefresh.js'
import { createApiError, isTransientApiError } from '../../shared/errors/apiError.js'
import { syncRoleHint } from './authNavigation.js'
import { login as loginRequest, logout as logoutRequest } from './authService.js'
import { queryClient } from '../../shared/services/queryClient.js'

const LEGACY_STORAGE_KEY = 'iot_monitoring_auth'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null)
  const [sessionError, setSessionError] = useState(null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const removeUnauthorizedHandlerRef = useRef(() => {})
  const explicitlyLoggedOutRef = useRef(false)
  const identityRef = useRef(null)

  const clearSession = useCallback(() => {
    queryClient.clear()
    if (identityRef.current !== null) {
      setSessionEpoch((epoch) => epoch + 1)
    }
    identityRef.current = null
    removeUnauthorizedHandlerRef.current()
    syncRoleHint(null)
    setSessionError(null)
    setAuth(null)
  }, [])

  const applySession = useCallback((payload) => {
    const identity = `${payload?.user?.id || ''}:${payload?.user?.role || ''}`
    if (identityRef.current !== identity) queryClient.clear()
    if (identityRef.current !== null && identityRef.current !== identity) {
      setSessionEpoch((epoch) => epoch + 1)
    }
    identityRef.current = identity
    removeUnauthorizedHandlerRef.current()
    removeUnauthorizedHandlerRef.current = setUnauthorizedHandler(payload.token, () => clearSession())
    syncRoleHint(payload?.user?.role)
    setSessionError(null)
    setAuth(payload)
  }, [clearSession])

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

        setSessionError(null)
        return payload
      } catch (error) {
        if (explicitlyLoggedOutRef.current || generation !== getSessionGeneration()) return null
        if (isTransientApiError(error)) throw error

        clearSession()
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

    return () => {
      setSessionRefresher(null)
      removeUnauthorizedHandlerRef.current()
    }
  }, [applySession, clearSession])

  // Silent restore: a valid HttpOnly refresh cookie brings the session back
  // after a page reload without ever exposing a token to storage.
  const runSessionRestore = useCallback(async ({ signal } = {}) => {
    const generation = getSessionGeneration()
    if (!signal?.aborted) {
      setIsRestoring(true)
      setSessionError(null)
    }

    try {
      await refreshSessionOnce(undefined, { signal })
    } catch (error) {
      if (
        !signal?.aborted
        && !explicitlyLoggedOutRef.current
        && generation === getSessionGeneration()
        && error?.code !== 'REQUEST_ABORTED'
        && error?.name !== 'AbortError'
        && (error?.status === 0 || error?.status >= 500 || isTransientApiError(error))
      ) {
        setSessionError(error)
      }
    } finally {
      if (!signal?.aborted) setIsRestoring(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    runSessionRestore({ signal: controller.signal })

    return () => {
      controller.abort(Object.assign(new Error('Session restore cancelled.'), { name: 'AbortError' }))
    }
  }, [runSessionRestore])

  const login = useCallback(async (credentials) => {
    clearSession()
    const generation = beginSessionChange()
    const nextAuth = await withSessionLock(() => loginRequest(credentials))
    if (generation !== getSessionGeneration()) throw createApiError('Sign-in was cancelled.', 0, null, 'SESSION_CHANGED')
    explicitlyLoggedOutRef.current = false
    setCurrentSession(nextAuth)
    applySession(nextAuth)
    return nextAuth
  }, [applySession, clearSession])

  const logout = useCallback(async () => {
    explicitlyLoggedOutRef.current = true
    clearSession()
    endSessionAcrossTabs()

    try {
      await withSessionLock(logoutRequest)
    } catch {
      // Clear the local session even if the backend call fails.
    }
  }, [clearSession])

  const value = useMemo(
    () => ({
      token: auth?.token || null,
      user: auth?.user || null,
      isAuthenticated: Boolean(auth?.token),
      isRestoring,
      sessionError,
      retrySessionRestore: () => runSessionRestore(),
      login,
      logout,
    }),
    [auth, isRestoring, login, logout, runSessionRestore, sessionError],
  )

  return <AuthContext.Provider value={value}><Fragment key={sessionEpoch}>{children}</Fragment></AuthContext.Provider>
}
