import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  User,
  Zap,
} from 'lucide-react'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { getSafeDashboardPath } from './authNavigation.js'

const initialValues = {
  username: '',
  password: '',
}

function validate(values) {
  const nextErrors = {}

  if (!values.username.trim()) {
    nextErrors.username = 'Username is required.'
  }

  if (!values.password) {
    nextErrors.password = 'Password is required.'
  } else if (values.password.length < 6) {
    nextErrors.password = 'Password must be at least 6 characters.'
  }

  return nextErrors
}

export default function LoginPage() {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [serverError, setServerError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const usernameRef = useRef(null)
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const intendedRoute = getSafeDashboardPath(location.state?.from)
  const sessionExpiredMessage = location.state?.sessionExpired
    ? 'Your session expired. Sign in again to continue.'
    : ''

  // Focus username first so operators can start typing immediately.
  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  useEffect(() => {
    // If the user is already logged in, skip the login page.
    if (isAuthenticated) {
      navigate(intendedRoute, { replace: true })
    }
  }, [intendedRoute, isAuthenticated, navigate])

  useEffect(() => {
    if (!serverError) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setServerError('')
    }, 1500)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [serverError])

  function updateField(event) {
    const { name, value } = event.target
    const nextValues = { ...values, [name]: value }
    setValues(nextValues)
    setServerError('')

    if (touched[name]) {
      setErrors(validate(nextValues))
    }
  }

  function handleBlur(event) {
    const nextTouched = { ...touched, [event.target.name]: true }
    setTouched(nextTouched)
    setErrors(validate(values))
  }

  function handlePasswordKey(event) {
    setCapsLockOn(event.getModifierState?.('CapsLock') || false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched({ username: true, password: true })
    setServerError('')
    setSuccessMessage('')

    const nextErrors = validate(values)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    try {
      setSubmitState('loading')
      // Calls AuthContext.login, which stores the returned backend/mock auth payload.
      await login({
        username: values.username.trim(),
        password: values.password,
      })
      setSubmitState('success')
      setSuccessMessage('Access granted. Loading dashboard.')
      window.setTimeout(() => {
        navigate(intendedRoute, { replace: true })
      }, 450)
    } catch (error) {
      setSubmitState('idle')
      setServerError(error.message || 'Unable to sign in. Please try again.')
    }
  }

  const usernameError = touched.username ? errors.username : ''
  const passwordError = touched.password ? errors.password : ''

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="System information">
        <div className="brand-content">
          <div className="brand-logo-row">
            <img
              className="brand-logo"
              src="/assets/logo.png"
              alt="PetroHydroPipe logo"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
            <div className="logo-fallback" aria-hidden="true">
              <Zap size={22} />
              <span>PetroHydroPipe</span>
            </div>
          </div>

          <div>
            <p className="eyebrow">PetroHydroPipe</p>
            <p className="system-title">IoT Machine Monitoring System</p>
            <p className="facility">Dunggoan, Danao City, Cebu</p>
          </div>

        </div>
      </section>

      <section className="form-panel" aria-labelledby="login-title">
        <form id="login-form" name="login" className="login-card" onSubmit={handleSubmit} autoComplete="on" noValidate>
          <span className="security-badge">
            <ShieldCheck size={16} aria-hidden="true" />
            SECURED SYSTEM ACCESS
          </span>

          <div className="login-heading">
            <h1 id="login-title">Administrator Login</h1>
            <p>Authorized personnel only. All sessions are logged and audited.</p>
          </div>

          {serverError ? (
            <div className="notice notice-error" role="alert">
              <span>{serverError}</span>
            </div>
          ) : null}

          {sessionExpiredMessage ? (
            <div className="notice notice-error" role="alert">
              <span>{sessionExpiredMessage}</span>
            </div>
          ) : null}

          {successMessage ? (
            <div className="banner banner-success" role="status">
              <span>{successMessage}</span>
            </div>
          ) : null}

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

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className={`input-shell ${passwordError ? 'has-error' : ''}`}>
              <Lock size={18} aria-hidden="true" />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter password"
                value={values.password}
                onChange={updateField}
                onBlur={(event) => {
                  setCapsLockOn(false)
                  handleBlur(event)
                }}
                onKeyUp={handlePasswordKey}
                onKeyDown={handlePasswordKey}
                autoComplete="current-password"
                aria-invalid={Boolean(passwordError)}
                aria-describedby={`${passwordError ? 'password-error ' : ''}${capsLockOn ? 'caps-lock-warning' : ''}`.trim() || undefined}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
            </div>
            {passwordError ? (
              <p className="field-error" id="password-error" role="alert">
                {passwordError}
              </p>
            ) : null}
            {capsLockOn ? (
              <p className="caps-warning" id="caps-lock-warning" role="status">
                Caps Lock is active.
              </p>
            ) : null}
          </div>

          <button className="btn btn-primary" type="submit" disabled={submitState !== 'idle'}>
            {submitState === 'loading' ? <span className="spinner" aria-hidden="true" /> : null}
            {submitState === 'success' ? <CheckCircle2 size={20} aria-hidden="true" /> : null}
            {submitState === 'loading' ? 'Verifying Access' : submitState === 'success' ? 'Access Granted' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  )
}
