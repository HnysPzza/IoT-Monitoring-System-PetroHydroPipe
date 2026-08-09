import { createContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { setUnauthorizedHandler } from '../../shared/services/apiClient.js'
import { login as loginRequest } from './authService.js'

const AUTH_STORAGE_KEY = 'iot_monitoring_auth'
export const AuthContext = createContext(null)

// Reads the saved JWT/user payload so reloads keep the user signed in.
function readStoredAuth() {
  try {
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readStoredAuth)
  const [sessionExpired, setSessionExpired] = useState(false)
  const expiredTokenRef = useRef(null)

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
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
    })
  }, [auth?.token])

  // Login is the bridge from the UI to authService, then stores the returned token locally.
  async function login(credentials) {
    const nextAuth = await loginRequest(credentials)
    expiredTokenRef.current = null
    setSessionExpired(false)
    setAuth(nextAuth)
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth))
    return nextAuth
  }

  function logout() {
    expiredTokenRef.current = null
    setSessionExpired(false)
    setAuth(null)
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  // Shared auth object used by protected routes, API calls, and dashboard user display.
  const value = useMemo(
    () => ({
      token: auth?.token || null,
      user: auth?.user || null,
      isAuthenticated: Boolean(auth?.token),
      sessionExpired,
      login,
      logout,
    }),
    [auth, sessionExpired],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
