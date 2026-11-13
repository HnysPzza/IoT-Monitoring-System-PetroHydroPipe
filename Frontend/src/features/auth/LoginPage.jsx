import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { CheckCircle2, CircleAlert, User } from 'lucide-react'
import { getRoleDisplayName } from '../../shared/constants/roleLabels.js'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { AuthShell, PasswordInput } from './AuthShell.jsx'
import { getSafeDashboardPath } from './authNavigation.js'

const initialValues = {
  username: '',
  password: '',
}

function isWrongPasswordError(error) {
  if (!error) return false
  if (typeof error === 'object') {
    if (error.code === 'INVALID_CREDENTIALS' || error.status === 401) return true
    if (error.code) return false
  }
  const message = typeof error === 'string' ? error : error.message
  if (!message) return false
  return /invalid (username|password|credentials)|incorrect (username|password|credentials)|wrong (username|password|credentials)/i.test(message)
}

function validate(values) {
  const nextErrors = {}

  if (!values.username.trim()) {
    nextErrors.username = 'Username is required.'
  }

  if (!values.password) {
    nextErrors.password = 'Password is required.'
  }

  return nextErrors
}

// Authenticates plant staff and routes each role to its authorized workspace.
export default function LoginPage() {
  const location = useLocation()
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [serverError, setServerError] = useState('')
  const [serverErrorWrongPassword, setServerErrorWrongPassword] = useState(false)
  const [successMessage, setSuccessMessage] = useState(() => (
    location.state?.passwordChanged ? 'Password updated. Sign in with your new password.' : ''
  ))
  const [submitState, setSubmitState] = useState('idle')
  const [shake, setShake] = useState(false)
  const mountedRef = useRef(true)
  const usernameRef = useRef(null)
  const passwordRef = useRef(null)
  const redirectTimerRef = useRef(null)
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const nextQueryTarget = new URLSearchParams(location.search).get('next')
  const intendedRoute = getSafeDashboardPath(nextQueryTarget || location.state?.from)
  const managingDirectorLabel = getRoleDisplayName('Admin')
  const isBusy = submitState !== 'idle'

  useEffect(() => {
    mountedRef.current = true
    usernameRef.current?.focus()
    return () => {
      mountedRef.current = false
      window.clearTimeout(redirectTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (location.state?.passwordChanged) {
      setSuccessMessage('Password updated. Sign in with your new password.')
    }
  }, [location.state])

  useEffect(() => {
    // Redirect already-signed-in visitors without preempting active sign-in confirmation.
    if (isAuthenticated && submitState === 'idle') {
      navigate(intendedRoute, { replace: true })
    }
  }, [intendedRoute, isAuthenticated, navigate, submitState])

  function updateField(event) {
    const { name, value } = event.target
    const nextValues = { ...values, [name]: value }
    setValues(nextValues)
    setServerError('')
    setServerErrorWrongPassword(false)
    setShake(false)

    if (touched[name]) {
      setErrors(validate(nextValues))
    }
  }

  function handleBlur(event) {
    setTouched((prev) => ({ ...prev, [event.target.name]: true }))
    setErrors(validate(values))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitState !== 'idle') return
    setTouched({ username: true, password: true })
    setServerError('')
    setServerErrorWrongPassword(false)
    setShake(false)
    setSuccessMessage('')

    const nextErrors = validate(values)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.password) setShake(true)
      if (nextErrors.username) {
        usernameRef.current?.focus()
      } else if (nextErrors.password) {
        passwordRef.current?.focus()
      }
      return
    }

    try {
      setSubmitState('loading')
      await login({
        username: values.username.trim(),
        password: values.password,
      })
      if (!mountedRef.current) return
      setSubmitState('success')
      setSuccessMessage('Access granted. Loading dashboard.')
      window.clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) {
          navigate(intendedRoute, { replace: true })
        }
      }, 300)
    } catch (error) {
      if (!mountedRef.current) return
      setSubmitState('idle')
      const message = error.message || 'Unable to sign in. Please try again.'
      const wrongPassword = isWrongPasswordError(error)
      setServerError(message)
      setServerErrorWrongPassword(wrongPassword)
      if (wrongPassword) {
        setShake(true)
        passwordRef.current?.focus()
      }
    }
  }

  const usernameError = touched.username ? errors.username : ''
  const isWrongPassword = serverErrorWrongPassword
  const passwordError = touched.password ? errors.password : ''
  const passwordHasError = Boolean(passwordError || isWrongPassword)
  const passwordErrorMessage = passwordError || (isWrongPassword ? serverError : '')

  return (
    <AuthShell panelLabelledBy="login-title" cardKey="login">
      <div className="login-heading">
        <h1 id="login-title">Sign in to PHP-Monitoring</h1>
        <p>Access monitoring dashboards for your assigned plant role.</p>
      </div>

      {!isWrongPassword && serverError ? (
        <div className="notice notice-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{serverError}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div className="notice notice-success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <form id="login-form" name="login" className="auth-form" onSubmit={handleSubmit} autoComplete="on" noValidate>
        <div className="field">
          <label htmlFor="username">Username</label>
          <div className={`input-shell ${usernameError ? 'has-error' : ''}`}>
            <User size={18} aria-hidden="true" />
            <input
              ref={usernameRef}
              id="username"
              name="username"
              type="text"
              placeholder="Enter username"
              value={values.username}
              disabled={isBusy}
              onChange={updateField}
              onBlur={handleBlur}
              autoComplete="username"
              aria-invalid={Boolean(usernameError)}
              aria-describedby={usernameError ? 'username-error' : undefined}
            />
          </div>
          {usernameError ? (
            <p className="field-error" id="username-error" role="alert">
              {usernameError}
            </p>
          ) : null}
        </div>

        <PasswordInput
          id="password"
          name="password"
          label="Password"
          placeholder="Enter password"
          autoComplete="current-password"
          inputRef={passwordRef}
          value={values.password}
          disabled={isBusy}
          onChange={updateField}
          onBlur={handleBlur}
          hasError={passwordHasError}
          errorMessage={passwordErrorMessage}
          errorRole="alert"
          shake={shake}
          onAnimationEnd={() => setShake(false)}
        />

        <button className="btn btn-primary" type="submit" disabled={isBusy}>
          {submitState === 'loading' ? <span className="spinner" aria-hidden="true" /> : null}
          {submitState === 'success' ? <CheckCircle2 size={18} aria-hidden="true" /> : null}
          {submitState === 'loading' ? 'Verifying Access' : submitState === 'success' ? 'Access Granted' : 'Sign In'}
        </button>
      </form>

      <p className="auth-help-note">
        New user or need a password reset? Contact your {managingDirectorLabel} for a single-use setup link.
      </p>
    </AuthShell>
  )
}
