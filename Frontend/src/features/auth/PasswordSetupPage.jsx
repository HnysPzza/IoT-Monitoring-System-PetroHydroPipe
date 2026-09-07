import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../shared/hooks/useAuth.js'
import { apiRequest } from '../../shared/services/apiClient.js'
import './passwordSetup.css'

export default function PasswordSetupPage({ changePassword = false }) {
  const { token, logout } = useAuth()
  const [setupToken, setSetupToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const validLink = /^[0-9a-f]{64}$/.test(setupToken)

  useEffect(() => {
    if (!changePassword) window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [changePassword])

  async function submit(event) {
    event.preventDefault()
    if (submitting.current) return
    if (password !== confirmation) { setError('Passwords do not match.'); return }
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) {
      setError('Use at least 12 characters and at most 72 UTF-8 bytes.'); return
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
      setError(`${failure.message} If the request timed out, try signing in with your new password before requesting another link.`)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <main className="password-setup">
      <section className="section-card" aria-labelledby="password-setup-title">
        <h1 id="password-setup-title">{changePassword ? 'Change your password' : 'Set up your password'}</h1>
        {completed ? <p role="status">Password saved. <Link to="/login">Sign in</Link> with your new password.</p> : (
          <form onSubmit={submit}>
            <p>{changePassword ? 'Replace your temporary password before using the system.' : 'Choose your own password. Your administrator never receives it.'}</p>
            {!changePassword && !validLink ? <p role="alert">Missing or invalid setup link. Ask your administrator to resend it.</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {changePassword ? <label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} /></label> : null}
            <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} aria-describedby="password-guidance" /></label>
            <small id="password-guidance">At least 12 characters; at most 72 UTF-8 bytes. A long, unique passphrase works well.</small>
            <label>Confirm password<input type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
            <button className="btn btn-primary" disabled={busy || (!changePassword && !validLink)}>{busy ? 'Saving...' : changePassword ? 'Change password' : 'Set password'}</button>
          </form>
        )}
        {changePassword && !completed ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={logout}>Sign out</button> : null}
      </section>
    </main>
  )
}
