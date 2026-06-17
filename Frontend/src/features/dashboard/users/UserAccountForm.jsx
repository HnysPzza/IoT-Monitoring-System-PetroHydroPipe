import { LoaderCircle, Plus, UserPlus } from 'lucide-react'

export default function UserAccountForm({
  errors,
  form,
  isLoading,
  isSubmitting,
  onFieldChange,
  onSubmit,
  roles,
}) {
  return (
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

      <form id="user-account-form" name="userAccount" className="account-form" onSubmit={onSubmit} autoComplete="on" noValidate>
        {/* Form state lives in UsersSection so validation and API submit stay in one flow. */}
        <label className="account-field" htmlFor="account-name">
          <span>Full name</span>
          <input
            id="account-name"
            name="name"
            type="text"
            value={form.name}
            onChange={(event) => onFieldChange('name', event.target.value)}
            autoComplete="name"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'account-name-error' : undefined}
            disabled={isLoading}
          />
          {errors.name ? <small id="account-name-error" role="alert">{errors.name}</small> : null}
        </label>

        <label className="account-field" htmlFor="account-username">
          <span>Username</span>
          <input
            id="account-username"
            name="username"
            type="text"
            value={form.username}
            onChange={(event) => onFieldChange('username', event.target.value)}
            autoComplete="username"
            aria-invalid={Boolean(errors.username)}
            aria-describedby={errors.username ? 'account-username-error' : undefined}
            disabled={isLoading}
          />
          {errors.username ? <small id="account-username-error" role="alert">{errors.username}</small> : null}
        </label>

        <label className="account-field" htmlFor="account-email">
          <span>Email</span>
          <input
            id="account-email"
            name="email"
            type="email"
            value={form.email}
            onChange={(event) => onFieldChange('email', event.target.value)}
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'account-email-error' : undefined}
            disabled={isLoading}
          />
          {errors.email ? <small id="account-email-error" role="alert">{errors.email}</small> : null}
        </label>

        <label className="account-field" htmlFor="account-role">
          <span>Role</span>
          <select
            id="account-role"
            name="role"
            value={form.role}
            onChange={(event) => onFieldChange('role', event.target.value)}
            autoComplete="off"
            disabled={isLoading || roles.length === 0}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.name}>
                {role.name}
              </option>
            ))}
          </select>
          {errors.role ? <small role="alert">{errors.role}</small> : null}
        </label>

        <label className="account-field" htmlFor="account-password">
          <span>Temporary password</span>
          <input
            id="account-password"
            name="password"
            type="password"
            value={form.password}
            onChange={(event) => onFieldChange('password', event.target.value)}
            autoComplete="new-password"
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
  )
}
