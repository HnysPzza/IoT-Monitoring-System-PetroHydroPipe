import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { apiRequest } from '../../shared/services/apiClient.js'
import './passwordSetup.css'

const STRENGTH_COLORS = ['', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-emerald-500']

function PasswordField({
  autoComplete,
  disabled,
  errorMessage,
  errorRole = 'status',
  hasError = false,
  id,
  inputRef,
  label,
  onAnimationEnd,
  onChange,
  placeholder,
  shake = false,
  value,
}) {
  const [visible, setVisible] = useState(false)
  const [errorShake, setErrorShake] = useState(false)
  const prevErrorRef = useRef(false)
  const visibilityLabel = `${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`
  const errorId = `${id}-error`

  useEffect(() => {
    if (hasError && !prevErrorRef.current) {
      setErrorShake(true)
    } else if (!hasError) {
      setErrorShake(false)
    }
    prevErrorRef.current = hasError
  }, [hasError])

  const shouldShake = shake || errorShake

  return (
    <div className="password-field-compact">
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1.5">
        {label}
      </label>
      <div
        className={`password-input-shell-compact relative${hasError ? ' has-error' : ''}${shouldShake ? ' shake' : ''}`}
        onAnimationEnd={(event) => {
          setErrorShake(false)
          onAnimationEnd?.(event)
        }}
      >
        <input
          ref={inputRef}
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          minLength={id === 'new-password' ? 12 : undefined}
          maxLength={id === 'new-password' ? 72 : undefined}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={Boolean(hasError)}
          aria-describedby={errorMessage ? errorId : undefined}
          className="w-full h-11 pl-3.5 pr-10 rounded-lg bg-[#11192c] border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
        <button
          type="button"
          className="password-visibility-compact absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition-colors"
          aria-label={visibilityLabel}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={16} className="w-4 h-4" aria-hidden="true" /> : <Eye size={16} className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
      {errorMessage ? (
        <p id={errorId} className="password-field-warning" role={errorRole}>
          {errorMessage}
        </p>
      ) : null}
    </div>
  )
}

function passwordErrorMessage(code) {
  if (code === 'RATE_LIMITED') return 'Too many attempts. Wait up to 15 minutes, then try again.'
  if (code === 'VALIDATION_ERROR') return 'Check the password requirements and try again.'
  if (code === 'ACCOUNT_OPERATION_INVALID') return 'Link expired or used.'
  if (code === 'PASSWORD_INCORRECT') return 'Password does not match.'
  if (code === 'PASSWORD_UNCHANGED') return 'Choose a different password.'
  if (code === 'REQUEST_TIMEOUT') return 'Request timed out.'
  return 'Could not save password.'
}

export default function PasswordSetupPage({ changePassword = false, resetPassword = false }) {
  const { token, logout } = useAuth()
  const [linkToken, setLinkToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [currentPasswordError, setCurrentPasswordError] = useState('')
  const [currentPasswordShake, setCurrentPasswordShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const [linkState, setLinkState] = useState('checking')
  const [checkAttempt, setCheckAttempt] = useState(0)
  const submitting = useRef(false)
  const firstFieldRef = useRef(null)
  const validLink = /^[0-9a-f]{64}$/.test(linkToken)
  const passwordBytes = new TextEncoder().encode(password).length
  const passwordCharacters = Array.from(password).length
  const hasLength = passwordCharacters >= 12 && passwordBytes <= 72
  const hasUpperAndLower = /[a-z]/.test(password) && /[A-Z]/.test(password)
  const hasNumberAndSymbol = /[0-9]/.test(password) && /[!-/:-@\[-`{-~]/.test(password)
  const hasRequiredCharacters = hasUpperAndLower && hasNumberAndSymbol
  const confirmationMatches = password.length > 0 && password === confirmation
  const metRulesCount = [hasLength, hasUpperAndLower, hasNumberAndSymbol, confirmationMatches].filter(Boolean).length

  const newPasswordWarning = password.length > 0 && (!hasLength || !hasRequiredCharacters)
    ? 'Include at least 12 characters, uppercase, lowercase, a number, and a special character.'
    : ''
  const confirmPasswordWarning = confirmation.length > 0 && password !== confirmation
    ? 'Passwords do not match.'
    : ''

  const mode = changePassword
    ? {
        brandTitle: 'Protect your account',
        title: 'Change password',
      }
    : resetPassword
      ? {
          brandTitle: 'Reset your password',
          brandDescription: 'Choose a new account password.',
          title: 'Reset password',
        }
    : {
        brandTitle: 'Secure account setup',
        brandDescription: 'Create your account password.',
        title: 'Create password',
      }

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
    apiRequest(`/api/auth/${resetPassword ? 'password-reset' : 'setup-password'}/validate`, {
      method: 'POST', body: { token: linkToken }, signal: controller.signal,
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
      setLinkState(['SETUP_LINK_INVALID', 'PASSWORD_RESET_LINK_INVALID'].includes(failure.code) ? 'invalid' : 'error')
      setError('Could not check link.')
    })
    const recheck = () => setCheckAttempt((attempt) => attempt + 1)
    window.addEventListener('focus', recheck)
    return () => {
      controller.abort()
      window.clearTimeout(expiryTimer)
      window.removeEventListener('focus', recheck)
    }
  }, [changePassword, resetPassword, validLink, linkToken, completed, checkAttempt])

  async function submit(event) {
    event.preventDefault()
    if (submitting.current || (!changePassword && linkState !== 'valid')) return
    setCurrentPasswordError('')
    setCurrentPasswordShake(false)
    if (changePassword && !currentPassword) {
      setCurrentPasswordError('Password does not match.')
      setCurrentPasswordShake(true)
      firstFieldRef.current?.focus()
      return
    }
    if (password !== confirmation) { setError('Passwords do not match.'); return }
    if (passwordCharacters < 12 || passwordBytes > 72) {
      setError('Use at least 12 characters and no more than 72 UTF-8 bytes.'); return
    }
    if (!hasRequiredCharacters) {
      setError('Include uppercase, lowercase, a number, and a special character.'); return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const endpoint = changePassword ? 'change-password' : resetPassword ? 'password-reset' : 'setup-password'
      await apiRequest(`/api/auth/${endpoint}`, {
        method: 'POST', token: changePassword ? token : undefined,
        body: changePassword ? { currentPassword, password } : { token: linkToken, password },
      })
      setPassword('')
      setConfirmation('')
      setCurrentPassword('')
      setCurrentPasswordError('')
      setLinkToken('')
      setCompleted(true)
      if (changePassword) await logout()
    } catch (failure) {
      if (!changePassword && failure.code === 'ACCOUNT_OPERATION_INVALID') {
        setLinkState('invalid')
        setPassword('')
        setConfirmation('')
      }
      if (changePassword && failure.code === 'PASSWORD_INCORRECT') {
        setCurrentPasswordError('Password does not match.')
        setCurrentPasswordShake(true)
        firstFieldRef.current?.focus()
        return
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
                  <strong>{resetPassword ? 'Single-use reset' : 'One-time setup'}</strong>
                  Link must be valid.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="form-panel password-form-panel" aria-labelledby="password-setup-title">
        <div className="password-card password-card-compact w-full max-w-[480px] bg-[#0b111e]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 shadow-2xl space-y-6">
          {completed ? (
            <div className="password-state" role="status">
              <span className="password-state-icon password-state-success" aria-hidden="true">
                <CheckCircle2 size={30} />
              </span>
              <div>
                <p className="password-state-kicker">{resetPassword ? 'Password reset' : 'Setup complete'}</p>
                <h1 id="password-setup-title">{resetPassword ? 'Password reset' : 'Password saved'}</h1>
                <p>Sign in with your new password.</p>
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
              <div className="password-compact-header flex items-center justify-between">
                <h1 id="password-setup-title" className="text-xl font-semibold tracking-tight text-white">
                  {mode.title}
                </h1>
                <span className="password-char-counter text-xs font-mono text-slate-500 tabular-nums" aria-live="polite">
                  {passwordCharacters} / 72 chars
                </span>
              </div>

              {error ? (
                <div className="password-notice password-notice-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <form className="password-form-compact space-y-5" onSubmit={submit} noValidate>
                <div className="password-inputs-group space-y-4">
                  {changePassword ? (
                    <PasswordField
                      id="current-password"
                      label="Current password"
                      placeholder="Enter current password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => {
                        setCurrentPassword(event.target.value)
                        setCurrentPasswordError('')
                        setCurrentPasswordShake(false)
                      }}
                      disabled={busy}
                      inputRef={firstFieldRef}
                      hasError={Boolean(currentPasswordError)}
                      errorMessage={currentPasswordError}
                      errorRole="alert"
                      shake={currentPasswordShake}
                      onAnimationEnd={() => setCurrentPasswordShake(false)}
                    />
                  ) : null}

                  <PasswordField
                    id="new-password"
                    label="New password"
                    placeholder="Enter new password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError('')
                    }}
                    disabled={busy}
                    inputRef={changePassword ? undefined : firstFieldRef}
                    hasError={Boolean(newPasswordWarning)}
                    errorMessage={newPasswordWarning}
                  />

                  <PasswordField
                    id="confirm-password"
                    label="Confirm password"
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value)
                      setError('')
                    }}
                    disabled={busy}
                    hasError={Boolean(confirmPasswordWarning)}
                    errorMessage={confirmPasswordWarning}
                  />
                </div>

                <div className="password-validation-block pt-1">
                  <div className="password-strength-bar grid grid-cols-4 gap-1.5" aria-hidden="true">
                    {[1, 2, 3, 4].map((segmentIndex) => {
                      const activeLevel = segmentIndex <= metRulesCount ? metRulesCount : 0
                      const colorClass = activeLevel > 0 ? STRENGTH_COLORS[activeLevel] : 'bg-slate-800'
                      return (
                        <div
                          key={segmentIndex}
                          data-strength-segment={segmentIndex}
                          data-strength-level={activeLevel}
                          className={`password-strength-segment h-1.5 rounded-full ${colorClass} transition-colors duration-200`}
                        />
                      )
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  className="password-submit-compact w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-semibold shadow-sm transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="password-spinner w-4 h-4" size={16} aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" size={16} aria-hidden="true" />
                  )}
                  {busy ? 'Saving...' : changePassword ? 'Change password' : resetPassword ? 'Reset password' : 'Set password'}
                </button>
              </form>

              {changePassword ? (
                <div className="password-footer-compact pt-4 border-t border-white/[0.06] flex items-center justify-center gap-1.5 text-xs">
                  <span className="text-slate-400">Need another option?</span>
                  <button
                    type="button"
                    className="font-medium text-blue-400 hover:text-blue-300 transition-colors"
                    disabled={busy}
                    onClick={logout}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <p className="password-privacy-note password-footer-compact">
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
