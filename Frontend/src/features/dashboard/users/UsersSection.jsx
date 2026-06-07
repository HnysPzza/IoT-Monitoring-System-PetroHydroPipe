import { useMemo, useState } from 'react'
import { CheckCircle2, Plus, UserPlus, Users } from 'lucide-react'
import { initialUserAccounts, USER_ACCOUNTS_STORAGE_KEY, userRoles } from '../../../shared/data/userAccountsMock.js'

const initialForm = {
  name: '',
  username: '',
  email: '',
  role: 'Production Supervisor',
  password: '',
}

function getStoredAccounts() {
  try {
    const storedAccounts = window.localStorage.getItem(USER_ACCOUNTS_STORAGE_KEY)
    return storedAccounts ? JSON.parse(storedAccounts) : initialUserAccounts
  } catch {
    return initialUserAccounts
  }
}

function saveAccounts(accounts) {
  window.localStorage.setItem(USER_ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts))
}

function validateAccount(values, accounts) {
  const errors = {}
  const username = values.username.trim().toLowerCase()

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

  if (!values.role) {
    errors.role = 'Select a role.'
  }

  if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }

  if (!values.password) {
    errors.password = 'Temporary password is required.'
  } else if (values.password.length < 8) {
    errors.password = 'Temporary password must be at least 8 characters.'
  }

  return errors
}

export default function UsersSection() {
  const [accounts, setAccounts] = useState(getStoredAccounts)
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState({})
  const [createdAccount, setCreatedAccount] = useState('')

  const roleCounts = useMemo(
    () => userRoles.map((role) => ({
      role,
      count: accounts.filter((account) => account.role === role).length,
    })),
    [accounts],
  )

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: '' }))
    setCreatedAccount('')
  }

  function handleSubmit(event) {
    event.preventDefault()

    const nextErrors = validateAccount(form, accounts)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    const account = {
      id: `usr-${Date.now()}`,
      name: form.name.trim(),
      username: form.username.trim().toLowerCase(),
      email: form.email.trim(),
      role: form.role,
      status: 'Active',
      createdAt: new Date().toISOString().slice(0, 10),
      password: form.password,
    }

    setAccounts((current) => {
      const nextAccounts = [account, ...current]
      saveAccounts(nextAccounts)
      return nextAccounts
    })
    setForm(initialForm)
    setCreatedAccount(`${account.name} was created as ${account.role}.`)
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

        {createdAccount ? (
          <div className="notice notice-success dashboard-alert" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{createdAccount}</span>
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
            />
            {errors.email ? <small id="account-email-error" role="alert">{errors.email}</small> : null}
          </label>

          <label className="account-field">
            <span>Role</span>
            <select value={form.role} onChange={(event) => updateField('role', event.target.value)}>
              {userRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
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
            />
            {errors.password ? <small id="account-password-error" role="alert">{errors.password}</small> : null}
          </label>

          <button className="btn btn-primary account-submit" type="submit">
            <Plus size={18} aria-hidden="true" />
            Create account
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
        <div className="role-count-list">
          {roleCounts.map((item) => (
            <div key={item.role} className="role-count-row">
              <span>{item.role}</span>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
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
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.username}</td>
                  <td>{account.email || 'Not set'}</td>
                  <td>{account.role}</td>
                  <td>
                    <span className="status-badge status-running">{account.status}</span>
                  </td>
                  <td>{account.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
