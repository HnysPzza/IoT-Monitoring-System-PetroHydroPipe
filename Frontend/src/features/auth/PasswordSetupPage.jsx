import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock,
  KeyRound,
  LoaderCircle,
  Lock,
  LogIn,
  ShieldCheck,
} from 'lucide-react'
import { getRoleDisplayName } from '../../shared/constants/roleLabels.js'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { apiRequest } from '../../shared/services/apiClient.js'
import { AuthShell, PasswordInput } from './AuthShell.jsx'
import './passwordSetup.css'

const STRENGTH_LABELS = ['None', 'Weak', 'Fair', 'Good', 'Strong']

function passwordErrorMessage(code, { changePassword = false, managingDirectorLabel = 'Managing Director' } = {}) {
  if (code === 'RATE_LIMITED') return 'Too many attempts. Wait up to 15 minutes, then try again.'
  if (code === 'VALIDATION_ERROR') return 'Check the password requirements and try again.'
  if (code === 'ACCOUNT_OPERATION_INVALID') {
    return changePassword
      ? `Password change is not available for this account. Contact your ${managingDirectorLabel}.`
      : 'Link expired or used.'
  }
  if (code === 'PASSWORD_INCORRECT') return 'Password does not match.'
  if (code === 'PASSWORD_UNCHANGED') return 'Choose a different password.'
  if (code === 'REQUEST_TIMEOUT') return 'Request timed out.'
  return 'Could not save password.'
}

function formatLinkExpiry(validForMs) {
  if (!Number.isFinite(validForMs) || validForMs <= 0) return ''
  const minutes = Math.max(1, Math.round(validForMs / 60000))
  return `Single-use link · expires in about ${minutes} min.`
}

function formatMissingList(items) {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function buildPasswordRequirementWarning({
  passwordCharacters,
  passwordBytes,
  hasUpper,
  hasLower,
  hasNumber,
  hasSymbol,
}) {
  if (passwordBytes > 72) {
    return 'Password exceeds the 72-byte limit; shorten it or use fewer multi-byte symbols.'
  }

  const missing = []
  if (passwordCharacters < 12) missing.push('at least 12 characters')
  if (!hasUpper && !hasLower) missing.push('uppercase and lowercase letters')
  else if (!hasUpper) missing.push('uppercase letter')
  else if (!hasLower) missing.push('lowercase letter')
  if (!hasNumber) missing.push('number')
  if (!hasSymbol) missing.push('symbol or punctuation')

  return missing.length > 0 ? `Still needed: ${formatMissingList(missing)}.` : ''
}

function getModeConfig(changePassword, resetPassword) {
  if (changePassword) {
    return {
      title: 'Change password',
      description: 'Update your password before opening the monitoring dashboard.',
      submitLabel: 'Change password',
      completedHeading: 'Password saved',
    }
  }

  if (resetPassword) {
    return {
      title: 'Reset password',
      description: 'Choose a new password for your PetroHydroPipe account.',
      submitLabel: 'Reset password',
      completedHeading: 'Password reset',
    }
  }

  return {
    title: 'Create password',
    description: 'Set a password to activate your PetroHydroPipe account.',
    submitLabel: 'Set password',
    completedHeading: 'Password saved',
  }
}

function readStoredToken(key) {
  try {
    return window.sessionStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStoredToken(key, value) {
  try {
    if (value) window.sessionStorage.setItem(key, value)
    else window.sessionStorage.removeItem(key)
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

// Handles onboarding password creation, email password resets, and forced password updates.
export default function PasswordSetupPage({ changePassword = false, resetPassword = false }) {
  const navigate = useNavigate()
  const { token, logout } = useAuth()
  const managingDirectorLabel = getRoleDisplayName('Admin')
  const modeKey = `${changePassword}:${resetPassword}`
  const tokenStorageKey = `ph_setup_token_${modeKey}`
  const [linkToken, setLinkToken] = useState(() => {
    if (changePassword) return ''
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
    if (hashToken) return hashToken
    return readStoredToken(tokenStorageKey)
  })
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [currentPasswordError, setCurrentPasswordError] = useState('')
  const [touched, setTouched] = useState({ password: false, confirmation: false })
  const [submitErrorField, setSubmitErrorField] = useState('')
  const [shakeField, setShakeField] = useState('')
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const [linkState, setLinkState] = useState('checking')
  const [validForMs, setValidForMs] = useState(null)
  const [checkAttempt, setCheckAttempt] = useState(0)

  const prevModeKeyRef = useRef(modeKey)
  const submitting = useRef(false)
  const pendingFocusRef = useRef(null)
  const firstFieldRef = useRef(null)
  const newPasswordRef = useRef(null)
  const confirmPasswordRef = useRef(null)
  const stateHeadingRef = useRef(null)
  const prevCardStateRef = useRef(null)

  const validLink = /^[0-9a-f]{64}$/.test(linkToken)
  const passwordBytes = new TextEncoder().encode(password).length
  const passwordCharacters = Array.from(password).length
  const hasLength = passwordCharacters >= 12 && passwordBytes <= 72
  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasUpperAndLower = hasLower && hasUpper
  const hasNumber = /[0-9]/.test(password)
  const hasSymbol = /[\p{P}\p{S}]/u.test(password)
  const hasRequiredCharacters = hasUpperAndLower && hasNumber && hasSymbol
  const confirmationMatches = password.length > 0 && password === confirmation
  const ruleItems = [
    { key: 'length', label: '12–72 characters', met: hasLength },
    { key: 'case', label: 'Uppercase & lowercase', met: hasUpperAndLower },
    { key: 'number', label: 'At least one number', met: hasNumber },
    { key: 'symbol', label: 'Symbol or punctuation', met: hasSymbol },
  ]
  const strengthScore = [hasLength, hasUpperAndLower, hasNumber, hasSymbol].filter(Boolean).length
  const strengthLevel = password.length === 0 ? 0 : Math.max(1, strengthScore)
  const mode = getModeConfig(changePassword, resetPassword)

  const newPasswordInvalid = !hasLength || !hasRequiredCharacters
  const showNewPasswordError = touched.password && newPasswordInvalid
  const newPasswordWarning = showNewPasswordError
    ? buildPasswordRequirementWarning({
        passwordCharacters,
        passwordBytes,
        hasUpper,
        hasLower,
        hasNumber,
        hasSymbol,
      })
    : ''

  const showConfirmError = touched.confirmation && password !== confirmation
  const confirmPasswordWarning = showConfirmError ? 'Passwords do not match.' : ''
  const confirmPasswordStatus = !showConfirmError && confirmationMatches ? 'Passwords match.' : ''

  useEffect(() => {
    if (prevModeKeyRef.current === modeKey) return
    prevModeKeyRef.current = modeKey
    const hashToken = changePassword ? '' : (new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
    const nextToken = changePassword ? '' : (hashToken || readStoredToken(tokenStorageKey))
    setLinkToken(nextToken)
    setPassword('')
    setConfirmation('')
    setCurrentPassword('')
    setCurrentPasswordError('')
    setTouched({ password: false, confirmation: false })
    setSubmitErrorField('')
    setShakeField('')
    setCompleted(false)
    setError('')
    setLinkState('checking')
    setValidForMs(null)
  }, [changePassword, modeKey, tokenStorageKey])

  useEffect(() => {
    if (changePassword) return
    if (linkToken && !completed && linkState !== 'invalid') {
      writeStoredToken(tokenStorageKey, linkToken)
    } else if (completed || linkState === 'invalid') {
      writeStoredToken(tokenStorageKey, '')
    }
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
  }, [changePassword, completed, linkState, linkToken, modeKey, tokenStorageKey])

  useEffect(() => {
    if (changePassword || linkState === 'valid') firstFieldRef.current?.focus()
  }, [changePassword, linkState])

  useEffect(() => {
    if (!busy && pendingFocusRef.current) {
      const target = pendingFocusRef.current
      pendingFocusRef.current = null
      target.current?.focus()
    }
  }, [busy])

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
      setValidForMs(remaining)
      setLinkState(remaining > 0 ? 'valid' : 'invalid')
      expiryTimer = window.setTimeout(() => {
        setValidForMs(0)
        setLinkState('invalid')
        setPassword('')
        setConfirmation('')
      }, Math.max(0, remaining))
    }).catch((failure) => {
      if (controller.signal.aborted) return
      setValidForMs(null)
      setLinkState(['SETUP_LINK_INVALID', 'PASSWORD_RESET_LINK_INVALID'].includes(failure.code) ? 'invalid' : 'error')
      setError(
        failure.code === 'RATE_LIMITED'
          ? passwordErrorMessage('RATE_LIMITED', { changePassword, managingDirectorLabel })
          : 'Could not check link.',
      )
    })
    return () => {
      controller.abort()
      window.clearTimeout(expiryTimer)
    }
  }, [changePassword, resetPassword, validLink, linkToken, completed, checkAttempt, managingDirectorLabel])

  useEffect(() => {
    if (changePassword || linkState !== 'error') return undefined
    const recheck = () => setCheckAttempt((attempt) => attempt + 1)
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [changePassword, linkState])

  async function submit(event) {
    event.preventDefault()
    if (submitting.current || (!changePassword && linkState !== 'valid')) return
    setCurrentPasswordError('')
    setSubmitErrorField('')
    setError('')
    setShakeField('')

    if (changePassword && !currentPassword) {
      setCurrentPasswordError('Current password is required.')
      setShakeField('current')
      firstFieldRef.current?.focus()
      return
    }
    if (passwordCharacters < 12 || passwordBytes > 72 || !hasRequiredCharacters) {
      setTouched((prev) => ({ ...prev, password: true }))
      setSubmitErrorField('password')
      setShakeField('password')
      ;(changePassword ? newPasswordRef : firstFieldRef).current?.focus()
      return
    }
    if (password !== confirmation) {
      setTouched((prev) => ({ ...prev, confirmation: true }))
      setSubmitErrorField('confirmation')
      setShakeField('confirmation')
      confirmPasswordRef.current?.focus()
      return
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
      if (changePassword) {
        // Redirect to login before clearing auth state so ProtectedRoute never flashes 401.
        navigate('/login', { replace: true, state: { passwordChanged: true } })
        try {
          await logout()
        } catch {
          // Ignore logout transport errors after the password update already succeeded.
        }
      }
    } catch (failure) {
      if (!changePassword && failure.code === 'ACCOUNT_OPERATION_INVALID') {
        setLinkState('invalid')
        setPassword('')
        setConfirmation('')
      }
      if (changePassword && failure.code === 'PASSWORD_INCORRECT') {
        setCurrentPasswordError('Password does not match.')
        setShakeField('current')
        pendingFocusRef.current = firstFieldRef
        return
      }
      setError(passwordErrorMessage(failure.code, { changePassword, managingDirectorLabel }))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  async function handleSignOut() {
    navigate('/login', { replace: true })
    try {
      await logout()
    } catch {
      // Ignore logout transport errors after leaving the protected route.
    }
  }

  const expiryText = formatLinkExpiry(validForMs)
  const cardStateKey = completed
    ? 'completed'
    : !changePassword && (!validLink || linkState === 'invalid')
      ? 'invalid'
      : !changePassword && linkState !== 'valid'
        ? linkState
        : 'form'

  useEffect(() => {
    const previous = prevCardStateRef.current
    prevCardStateRef.current = cardStateKey
    if (previous === 'form' && (cardStateKey === 'completed' || cardStateKey === 'invalid' || cardStateKey === 'error')) {
      stateHeadingRef.current?.focus()
    }
  }, [cardStateKey])

  const brandPoints = !changePassword ? (
    <div className="password-security-points" aria-label="Password policy details">
      <div>
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>Private credentials</strong>
          Encrypted before storage; managers cannot view your password.
        </span>
      </div>
      <div>
        <KeyRound size={18} aria-hidden="true" />
        <span>
          <strong>{resetPassword ? 'Single-use reset link' : 'One-time setup link'}</strong>
          Valid once for 1 hour. Contact your {managingDirectorLabel} for a new link if expired.
        </span>
      </div>
    </div>
  ) : null

  return (
    <AuthShell
      brandLabel="Account information"
      brandPoints={brandPoints}
      cardKey={cardStateKey}
      panelLabelledBy="password-setup-title"
    >
      {completed ? (
        <div className="password-state" role="status">
          <span className="password-state-icon password-state-success" aria-hidden="true">
            <CheckCircle2 size={24} />
          </span>
          <div className="password-state-copy">
            <h1 ref={stateHeadingRef} id="password-setup-title" tabIndex={-1}>{mode.completedHeading}</h1>
            <p>Sign in with your new password.</p>
          </div>
          <Link className="btn btn-primary password-state-action" to="/login">
            Sign in
            <LogIn size={18} aria-hidden="true" />
          </Link>
        </div>
      ) : !changePassword && (!validLink || linkState === 'invalid') ? (
        <div className="password-state" role="alert">
          <span className="password-state-icon password-state-error" aria-hidden="true">
            <CircleAlert size={24} />
          </span>
          <div className="password-state-copy">
            <h1 ref={stateHeadingRef} id="password-setup-title" tabIndex={-1}>{validLink ? 'Link expired or used' : 'Link unavailable'}</h1>
            <p>
              Password links work once for 1 hour and cannot be reused after reload. Contact your {managingDirectorLabel} to issue a new link.
            </p>
          </div>
          <Link className="btn btn-secondary password-state-action" to="/login">
            Back to sign in
          </Link>
        </div>
      ) : !changePassword && linkState !== 'valid' ? (
        <div className="password-state" role={linkState === 'error' ? 'alert' : 'status'}>
          {linkState === 'error' ? (
            <>
              <span className="password-state-icon password-state-error" aria-hidden="true">
                <CircleAlert size={24} />
              </span>
              <div className="password-state-copy">
                <h1 ref={stateHeadingRef} id="password-setup-title" tabIndex={-1}>Link check failed</h1>
                <p>{error} Try again or ask your {managingDirectorLabel} for a new link.</p>
              </div>
              <button
                type="button"
                className="btn btn-primary password-state-action"
                onClick={() => setCheckAttempt((attempt) => attempt + 1)}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <span className="password-state-icon password-state-loading" aria-hidden="true">
                <LoaderCircle size={24} className="password-spinner" />
              </span>
              <div className="password-state-copy">
                <h1 id="password-setup-title">Checking link...</h1>
                <p>Verifying single-use link validity before unlocking password fields.</p>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="auth-state-panel">
          <div className="password-header">
            <div className="password-header-copy">
              <h1 id="password-setup-title">{mode.title}</h1>
              <p>{mode.description}</p>
            </div>
          </div>

          {!changePassword && expiryText ? (
            <p className="password-expiry-note">
              <Clock size={14} aria-hidden="true" />
              <span>{expiryText}</span>
            </p>
          ) : null}

          {error ? (
            <div className="notice notice-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <form className="auth-form" onSubmit={submit} noValidate>
            {changePassword ? (
              <PasswordInput
                id="current-password"
                label="Current password"
                placeholder="Enter current password"
                autoComplete="current-password"
                icon={KeyRound}
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value)
                  setCurrentPasswordError('')
                  setShakeField('')
                }}
                disabled={busy}
                inputRef={firstFieldRef}
                hasError={Boolean(currentPasswordError)}
                errorMessage={currentPasswordError}
                errorRole="alert"
                shake={shakeField === 'current'}
                onAnimationEnd={() => setShakeField('')}
              />
            ) : null}

            <PasswordInput
              id="new-password"
              label="New password"
              labelTrailing={(
                <span className="password-char-counter">
                  {passwordCharacters} / 72 chars
                </span>
              )}
              placeholder="Create a strong password"
              autoComplete="new-password"
              icon={Lock}
              minLength={12}
              maxLength={72}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError('')
                if (submitErrorField === 'password') setSubmitErrorField('')
                setShakeField('')
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
              disabled={busy}
              inputRef={changePassword ? newPasswordRef : firstFieldRef}
              hasError={Boolean(newPasswordWarning)}
              errorMessage={newPasswordWarning}
              errorRole={submitErrorField === 'password' ? 'alert' : ''}
              shake={shakeField === 'password'}
              onAnimationEnd={() => setShakeField('')}
            />

            <PasswordInput
              id="confirm-password"
              label="Confirm password"
              placeholder="Re-enter new password"
              autoComplete="new-password"
              icon={Lock}
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value)
                setError('')
                if (submitErrorField === 'confirmation') setSubmitErrorField('')
                setShakeField('')
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, confirmation: true }))}
              disabled={busy}
              inputRef={confirmPasswordRef}
              hasError={Boolean(confirmPasswordWarning)}
              errorMessage={confirmPasswordWarning}
              errorRole={submitErrorField === 'confirmation' ? 'alert' : ''}
              statusMessage={confirmPasswordStatus}
              shake={shakeField === 'confirmation'}
              onAnimationEnd={() => setShakeField('')}
            />

            <div className="password-guidance">
              <div className="password-strength-header">
                <span className="password-strength-title">Password strength</span>
                <span
                  className="password-strength-label"
                  data-level={strengthLevel}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  Strength: {STRENGTH_LABELS[strengthLevel]}
                </span>
              </div>
              <div className="password-strength-bar" aria-hidden="true">
                {[1, 2, 3, 4].map((segmentIndex) => (
                  <div
                    key={segmentIndex}
                    data-strength-segment={segmentIndex}
                    data-strength-level={segmentIndex <= strengthLevel ? strengthLevel : 0}
                    className="password-strength-segment"
                  />
                ))}
              </div>
              <ul className="password-checklist" aria-label="Password requirements">
                {ruleItems.map((item) => (
                  <li key={item.key} className={`password-checklist-item${item.met ? ' is-met' : ''}`}>
                    {item.met ? <CheckCircle2 size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="password-spinner" size={18} aria-hidden="true" />
              ) : (
                <ShieldCheck size={18} aria-hidden="true" />
              )}
              {busy ? 'Saving...' : mode.submitLabel}
            </button>
          </form>

          {changePassword ? (
            <div className="password-footer">
              <span>Need to switch accounts?</span>
              <button
                type="button"
                className="password-signout-link"
                disabled={busy}
                onClick={handleSignOut}
              >
                Sign out
              </button>
            </div>
          ) : (
            <p className="password-privacy-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Password stays private. Reloading invalidates this one-time link.</span>
            </p>
          )}
        </div>
      )}
    </AuthShell>
  )
}
