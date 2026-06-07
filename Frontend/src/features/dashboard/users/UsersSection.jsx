import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, Plus, UserPlus, Users } from 'lucide-react'
import { useAuth } from '../../../shared/session/AuthContext.jsx'
import { createUser, getRoles, getUsers, updateUserStatus } from './usersService.js'

const initialForm = {
  name: '',
  username: '',
  email: '',
  role: '',
  password: '',
}

function normalizeUsername(username) {
  return username.trim().toLowerCase()
}

function validateAccount(values, accounts) {
  const errors = {}
  const username = normalizeUsername(values.username)
  const email = values.email.trim().toLowerCase()

  if (!values.name.trim()) {
    errors.name = 'Full name is required.'
  }

  if (!username) {
    errors.username = 'Username is required.'
  } else if (!/^[a-z0-9._-]+$/.test(username)) {
    errors.username = 'Use lowercase letters, numbers, dots, dashes, or underscores only.'
  } else if (accounts.some((account) => account.username.toLowerCase() === username)) {
    errors.username = 'This username already exists.'
  }

  if (!email) {
    errors.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.'
  } else if (accounts.some((account) => account.email?.toLowerCase() === email)) {
    errors.email = 'This email already exists.'
  }

  if (!values.role) {
    errors.role = 'Select a role.'
  }

  if (!values.password) {
    errors.password = 'Temporary password is required.'
  } else if (values.password.length < 8) {
    errors.password = 'Temporary password must be at least 8 characters.'
  }

  return errors
}

function getStatusClass(status) {
  return status === 'Active' ? 'status-running' : 'status-downtime'
}

function formatDate(value) {
  if (!value) {
    return 'Not available'
  }

  return new Date(value).toLocaleDateString('en-PH', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
}

export default function UsersSection() {
  const { token, user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [roles, setRoles] = useState([])
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [updatingUserId, setUpdatingUserId] = useState('')

  const roleCounts = useMemo(
    () => roles.map((role) => ({
      role: role.name,
      count: accounts.filter((account) => account.role === role.name).length,
    })),
    [accounts, roles],
  )

  useEffect(() => {
    let isMounted = true

    async function loadUsersPage() {
      setIsLoading(true)
      setNotice(null)

      try {
        const [usersPayload, rolesPayload] = await Promise.all([
          getUsers(token),
          getRoles(token),
        ])

        if (!isMounted) {
          return
        }

        const nextRoles = rolesPayload.roles || []
        setAccounts(usersPayload.users || [])
        setRoles(nextRoles)
        setForm((current) => ({
          ...current,
          role: current.role || nextRoles.find((role) => role.name === 'Production Supervisor')?.name || nextRoles[0]?.name || '',
        }))
      } catch (error) {
        if (isMounted) {
          setNotice({
            type: 'error',
            message: error.message || 'Unable to load user accounts.',
          })
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadUsersPage()

    return () => {
      isMounted = false
    }
  }, [token])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: '' }))
    setNotice(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const nextErrors = validateAccount(form, accounts)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setIsSubmitting(true)
    setNotice(null)

    try {
      const payload = await createUser(token, {
        name: form.name.trim(),
        username: normalizeUsername(form.username),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        password: form.password,
      })

      setAccounts((current) => [payload.user, ...current])
      setForm({
        ...initialForm,
        role: form.role,
      })
      setNotice({
        type: 'success',
        message: `${payload.user.name} was created as ${payload.user.role}.`,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.message || 'Unable to create user account.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStatusChange(account) {
    const nextStatus = account.status === 'Active' ? 'Inactive' : 'Active'
    setUpdatingUserId(account.id)
    setNotice(null)

    try {
      const payload = await updateUserStatus(token, account.id, nextStatus)
      setAccounts((current) => current.map((item) => (item.id === payload.user.id ? payload.user : item)))
      setNotice({
        type: 'success',
        message: `${payload.user.username} is now ${payload.user.status}.`,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.message || 'Unable to update user status.',
      })
    } finally {
      setUpdatingUserId('')
    }
  }

  return (
    <div className="users-layout">
      <section className="section-card users-create-card" aria-labelledby="create-account-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Admin only</p>
            <h2 id="create-account-title">Create user account</h2>
          </div>
          <span className="section-chip">
            <UserPlus size={16} aria-hidden="true" />
            Role access
          </span>
        </div>

        {notice ? (
          <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
            {notice.type === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            <span>{notice.message}</span>
          </div>
        ) : null}

        <form className="account-form" onSubmit={handleSubmit} noValidate>
          <label className="account-field">
            <span>Full name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'account-name-error' : undefined}
              disabled={isLoading}
            />
            {errors.name ? <small id="account-name-error" role="alert">{errors.name}</small> : null}
          </label>

          <label className="account-field">
            <span>Username</span>
            <input
              type="text"
              value={form.username}
              onChange={(event) => updateField('username', event.target.value)}
              aria-invalid={Boolean(errors.username)}
              aria-describedby={errors.username ? 'account-username-error' : undefined}
              disabled={isLoading}
            />
            {errors.username ? <small id="account-username-error" role="alert">{errors.username}</small> : null}
          </label>

          <label className="account-field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateField('email', event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'account-email-error' : undefined}
              disabled={isLoading}
            />
            {errors.email ? <small id="account-email-error" role="alert">{errors.email}</small> : null}
          </label>

          <label className="account-field">
            <span>Role</span>
            <select value={form.role} onChange={(event) => updateField('role', event.target.value)} disabled={isLoading || roles.length === 0}>
              {roles.map((role) => (
                <option key={role.id} value={role.name}>
                  {role.name}
                </option>
              ))}
            </select>
            {errors.role ? <small role="alert">{errors.role}</small> : null}
          </label>

          <label className="account-field">
            <span>Temporary password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => updateField('password', event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'account-password-error' : undefined}
              disabled={isLoading}
            />
            {errors.password ? <small id="account-password-error" role="alert">{errors.password}</small> : null}
          </label>

          <button className="btn btn-primary account-submit" type="submit" disabled={isLoading || isSubmitting}>
            {isSubmitting ? <LoaderCircle className="spin-icon" size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
            {isSubmitting ? 'Creating...' : 'Create account'}
          </button>
        </form>
      </section>

      <aside className="section-card role-summary-card" aria-labelledby="role-summary-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Access summary</p>
            <h2 id="role-summary-title">Accounts by role</h2>
          </div>
          <span className="section-chip">
            <Users size={16} aria-hidden="true" />
            {accounts.length} total
          </span>
        </div>

        {isLoading ? (
          <div className="role-count-list" aria-label="Loading role summary">
            <span className="skeleton skeleton-label" />
            <span className="skeleton skeleton-label" />
            <span className="skeleton skeleton-label" />
          </div>
        ) : (
          <div className="role-count-list">
            {roleCounts.map((item) => (
              <div key={item.role} className="role-count-row">
                <span>{item.role}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        )}
      </aside>

      <section className="section-card users-table-card" aria-labelledby="accounts-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Directory</p>
            <h2 id="accounts-title">User accounts</h2>
          </div>
        </div>

        <div className="account-table-wrap">
          <table className="account-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Username</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">Last login</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan="8">Loading user accounts...</td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan="8">No user accounts found.</td>
                </tr>
              ) : (
                accounts.map((account) => {
                  const isCurrentUser = account.id === user?.id
                  const nextStatus = account.status === 'Active' ? 'Inactive' : 'Active'

                  return (
                    <tr key={account.id}>
                      <td>{account.name}</td>
                      <td>{account.username}</td>
                      <td>{account.email}</td>
                      <td>{account.role}</td>
                      <td>
                        <span className={`status-badge ${getStatusClass(account.status)}`}>{account.status}</span>
                      </td>
                      <td>{formatDate(account.createdAt)}</td>
                      <td>{formatDate(account.lastLoginAt)}</td>
                      <td>
                        <button
                          className="btn btn-secondary table-action-button"
                          type="button"
                          onClick={() => handleStatusChange(account)}
                          disabled={updatingUserId === account.id || (isCurrentUser && nextStatus === 'Inactive')}
                        >
                          {updatingUserId === account.id ? 'Updating...' : nextStatus}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
