import { createContext, useContext, useMemo, useState } from 'react'
import { login as loginRequest } from '../../features/auth/authService.js'

const AUTH_STORAGE_KEY = 'iot_monitoring_auth'
const AuthContext = createContext(null)

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

  async function login(credentials) {
    const nextAuth = await loginRequest(credentials)
    setAuth(nextAuth)
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth))
    return nextAuth
  }

  function logout() {
    setAuth(null)
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  const value = useMemo(
    () => ({
      token: auth?.token || null,
      user: auth?.user || null,
      isAuthenticated: Boolean(auth?.token),
      login,
      logout,
    }),
    [auth],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }

  return context
}
