import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  ShieldCheck,
  UserRoundCheck,
  Zap,
} from 'lucide-react'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { apiRequest } from '../../shared/services/apiClient.js'
import './passwordSetup.css'

function PasswordField({
  autoComplete,
  describedBy,
  disabled,
  id,
  inputRef,
  label,
  onChange,
  value,
}) {
  const [visible, setVisible] = useState(false)
  const visibilityLabel = `${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`

  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input-shell">
        <LockKeyhole size={18} aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={id === 'new-password' ? 12 : undefined}
          maxLength={id === 'new-password' ? 72 : undefined}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className="password-visibility"
          aria-label={visibilityLabel}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}

function passwordErrorMessage(code) {
  if (code === 'RATE_LIMITED') return 'Too many attempts. Wait up to 15 minutes, then try again.'
  if (code === 'VALIDATION_ERROR') return 'Check the password requirements and try again.'
  if (code === 'ACCOUNT_OPERATION_INVALID') return 'Link expired or used.'
  if (code === 'PASSWORD_INCORRECT') return 'Current password is wrong.'
  if (code === 'PASSWORD_UNCHANGED') return 'Choose a different password.'
  if (code === 'REQUEST_TIMEOUT') return 'Request timed out.'
  return 'Could not save password.'
}

export default function PasswordSetupPage({ changePassword = false }) {
  const { token, logout } = useAuth()
  const [setupToken, setSetupToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const [linkState, setLinkState] = useState('checking')
  const [checkAttempt, setCheckAttempt] = useState(0)
  const submitting = useRef(false)
  const firstFieldRef = useRef(null)
  const validLink = /^[0-9a-f]{64}$/.test(setupToken)
  const passwordBytes = new TextEncoder().encode(password).length
  const hasRequiredCharacters = /[a-z]/.test(password) && /[A-Z]/.test(password)
    && /[0-9]/.test(password) && /[!-/:-@\[-`{-~]/.test(password)
  const confirmationMatches = confirmation.length > 0 && password === confirmation
  const mode = changePassword
    ? {
        badge: 'Password update',
        brandTitle: 'Protect your account',
        title: 'Change password',
        description: 'Choose a new password.',
      }
    : {
        badge: 'Secure setup',
        brandTitle: 'Secure account setup',
        brandDescription: 'Create your account password.',
        title: 'Create password',
        description: 'Finish your account setup.',
      }
  const requirements = [
    { label: 'Uppercase, lowercase, number, special character', met: hasRequiredCharacters },
    { label: 'At least 12 characters', met: password.length >= 12 },
    { label: 'Max 72 UTF-8 bytes', met: password.length > 0 && passwordBytes <= 72 },
    { label: confirmationMatches ? 'Passwords match' : 'Passwords must match', met: confirmationMatches },
  ]

  useEffect(() => {
    if (!changePassword) window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [changePassword])

  useEffect(() => {
    if (changePassword || linkState === 'valid') firstFieldRef.current?.focus()
  }, [changePassword, linkState])

  useEffect(() => {
    if (changePassword || !validLink || completed) return
    const controller = new AbortController()
    let expiryTimer
    const startedAt = Date.now()
    setLinkState('checking')
    setError('')
    apiRequest('/api/auth/setup-password/validate', {
      method: 'POST', body: { token: setupToken }, signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return
      if (!Number.isFinite(result?.validForMs) || result.validForMs <= 0) {
        throw new Error('Could not check link.')
      }
      const remaining = result.validForMs - (Date.now() - startedAt)
      setLinkState(remaining > 0 ? 'valid' : 'invalid')
      expiryTimer = window.setTimeout(() => {
        setLinkState('invalid')
        setPassword('')
        setConfirmation('')
      }, Math.max(0, remaining))
    }).catch((failure) => {
      if (controller.signal.aborted) return
      setLinkState(failure.code === 'SETUP_LINK_INVALID' ? 'invalid' : 'error')
      setError('Could not check link.')
    })
    const recheck = () => setCheckAttempt((attempt) => attempt + 1)
    window.addEventListener('focus', recheck)
    return () => {
      controller.abort()
      window.clearTimeout(expiryTimer)
      window.removeEventListener('focus', recheck)
    }
  }, [changePassword, validLink, setupToken, completed, checkAttempt])

  async function submit(event) {
    event.preventDefault()
    if (submitting.current || (!changePassword && linkState !== 'valid')) return
    if (password !== confirmation) { setError('Passwords do not match.'); return }
    if (password.length < 12 || passwordBytes > 72) {
      setError('Use at least 12 characters and no more than 72 UTF-8 bytes.'); return
    }
    if (!hasRequiredCharacters) {
      setError('Include uppercase, lowercase, a number, and a special character.'); return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/auth/${changePassword ? 'change-password' : 'setup-password'}`, {
        method: 'POST', token: changePassword ? token : undefined,
        body: changePassword ? { currentPassword, password } : { token: setupToken, password },
      })
      setPassword('')
      setConfirmation('')
      setCurrentPassword('')
      setSetupToken('')
      setCompleted(true)
      if (changePassword) await logout()
    } catch (failure) {
      if (!changePassword && failure.code === 'ACCOUNT_OPERATION_INVALID') {
        setLinkState('invalid')
        setPassword('')
        setConfirmation('')
      }
      setError(passwordErrorMessage(failure.code))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <main className={`login-page password-auth-page${changePassword ? ' password-auth-page-legacy' : ''}`}>
      <section className="brand-panel" aria-label="Account information">
        <div className="brand-content password-brand-content">
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

          <div className="password-brand-copy">
            <p className="eyebrow">IoT Monitoring System</p>
            <h2 className="system-title">{mode.brandTitle}</h2>
            {!changePassword ? <p className="facility">{mode.brandDescription}</p> : null}
          </div>

          {!changePassword ? (
            <div className="password-security-points" aria-label="Password security">
              <div>
                <ShieldCheck size={20} aria-hidden="true" />
                <span>
                  <strong>Private password</strong>
                  Admins cannot see it.
                </span>
              </div>
              <div>
                <KeyRound size={20} aria-hidden="true" />
                <span>
                  <strong>One-time setup</strong>
                  Link must be valid.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="form-panel password-form-panel" aria-labelledby="password-setup-title">
        <div className="password-card">
          {completed ? (
            <div className="password-state" role="status">
              <span className="password-state-icon password-state-success" aria-hidden="true">
                <CheckCircle2 size={30} />
              </span>
              <div>
                <p className="password-state-kicker">Setup complete</p>
                <h1 id="password-setup-title">Password saved</h1>
                <p>Use your new password.</p>
              </div>
              <Link className="btn btn-primary password-primary-action" to="/login">
                Sign in
                <LogIn size={18} aria-hidden="true" />
              </Link>
            </div>
          ) : !changePassword && (!validLink || linkState === 'invalid') ? (
            <div className="password-state" role="alert">
              <span className="password-state-icon password-state-error" aria-hidden="true">
                <CircleAlert size={30} />
              </span>
              <div>
                <p className="password-state-kicker">Link unavailable</p>
                <h1 id="password-setup-title">{validLink ? 'Link expired or used' : 'Link unavailable'}</h1>
                <p>Request a new link.</p>
              </div>
              <Link className="btn btn-secondary password-secondary-link" to="/login">Back to sign in</Link>
            </div>
          ) : !changePassword && linkState !== 'valid' ? (
            <div className="password-state" role={linkState === 'error' ? 'alert' : 'status'}>
              <h1 id="password-setup-title">{linkState === 'error' ? 'Link check failed' : 'Checking link...'}</h1>
              {linkState === 'error' ? <>
                <p>{error}</p>
                <button type="button" className="btn btn-primary" onClick={() => setCheckAttempt((attempt) => attempt + 1)}>Try again</button>
              </> : <LoaderCircle className="password-spinner" aria-hidden="true" />}
            </div>
          ) : (
            <>
              <span className="password-security-badge">
                <UserRoundCheck size={16} aria-hidden="true" />
                {mode.badge}
              </span>

              <div className="password-heading">
                <h1 id="password-setup-title">{mode.title}</h1>
                <p>{mode.description}</p>
              </div>

              {error ? (
                <div className="password-notice password-notice-error" role="alert">
                  <CircleAlert size={18} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <form className="password-form" onSubmit={submit} noValidate>
                {changePassword ? (
                  <PasswordField
                    id="current-password"
                    label="Current password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    disabled={busy}
                    inputRef={firstFieldRef}
                  />
                ) : null}

                <PasswordField
                  id="new-password"
                  label="New password"
                  autoComplete="new-password"
                  describedBy="password-requirements"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                  inputRef={changePassword ? undefined : firstFieldRef}
                />

                <ul id="password-requirements" className="password-requirements" aria-label="Password requirements">
                  {requirements.map((requirement) => (
                    <li key={requirement.label} className={requirement.met ? 'is-met' : ''}>
                      {requirement.met ? <Check size={16} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                      <span className="sr-only">{requirement.met ? 'Met: ' : 'Required: '}</span>
                      {requirement.label}
                    </li>
                  ))}
                </ul>

                <PasswordField
                  id="confirm-password"
                  label="Confirm password"
                  autoComplete="new-password"
                  describedBy="password-requirements"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                />

                <button className="btn btn-primary password-primary-action" disabled={busy}>
                  {busy ? <LoaderCircle className="password-spinner" size={18} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
                  {busy ? 'Saving...' : changePassword ? 'Change password' : 'Set password'}
                </button>
              </form>

              {changePassword ? (
                <div className="password-card-footer">
                  <span>Need another option?</span>
                  <button type="button" disabled={busy} onClick={logout}>Sign out</button>
                </div>
              ) : (
                <p className="password-privacy-note">
                  <ShieldCheck size={16} aria-hidden="true" />
                  Password stays private.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  )
}
