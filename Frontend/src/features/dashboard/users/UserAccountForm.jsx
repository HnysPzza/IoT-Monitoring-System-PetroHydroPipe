import {
  AtSign,
  Clock,
  HelpCircle,
  LoaderCircle,
  Mail,
  Shield,
  ShieldCheck,
  User,
  UserPlus,
  X,
} from 'lucide-react'

export default function UserAccountForm({
  errors,
  form,
  isLoading,
  isSubmitting,
  onClose,
  onFieldChange,
  onSubmit,
  roles,
}) {
  return (
    <div className="users-create-modal" aria-labelledby="create-account-title">
      <div className="modal-header-row">
        <div className="modal-title-wrap">
          <h2 id="create-account-title" className="modal-title">Add user</h2>
          <span className="modal-admin-badge">
            <ShieldCheck size={12} aria-hidden="true" />
            <span>Admin only</span>
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            className="btn-modal-close"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={isLoading || isSubmitting}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="account-invite-banner" role="status">
        <Clock size={16} className="banner-icon" aria-hidden="true" />
        <span>An invite link will be sent to the user's email to set their password. The link expires in 1 hour.</span>
      </div>

      <form id="user-account-form" name="userAccount" className="account-form" onSubmit={onSubmit} autoComplete="on" noValidate>
        {/* Form state lives in UsersSection so validation and API submit stay in one flow. */}
        <div className="account-field">
          <label htmlFor="account-name">Full name</label>
          <div className="account-input-wrap">
            <User size={16} className="input-inset-icon" aria-hidden="true" />
            <input
              id="account-name"
              name="name"
              maxLength={120}
              type="text"
              placeholder="e.g., Alex Morgan"
              value={form.name}
              onChange={(event) => onFieldChange('name', event.target.value)}
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'account-name-error' : undefined}
              disabled={isLoading}
            />
          </div>
          {errors.name ? <small id="account-name-error" role="alert">{errors.name}</small> : null}
        </div>

        <div className="account-field">
          <label htmlFor="account-username">Username</label>
          <div className="account-input-wrap">
            <AtSign size={16} className="input-inset-icon" aria-hidden="true" />
            <input
              id="account-username"
              name="username"
              maxLength={80}
              type="text"
              placeholder="e.g., amorgan"
              value={form.username}
              onChange={(event) => onFieldChange('username', event.target.value)}
              autoComplete="username"
              aria-invalid={Boolean(errors.username)}
              aria-describedby={errors.username ? 'account-username-error' : undefined}
              disabled={isLoading}
            />
          </div>
          {errors.username ? <small id="account-username-error" role="alert">{errors.username}</small> : null}
        </div>

        <div className="account-field">
          <label htmlFor="account-email">Email</label>
          <div className="account-input-wrap">
            <Mail size={16} className="input-inset-icon" aria-hidden="true" />
            <input
              id="account-email"
              name="email"
              maxLength={254}
              type="email"
              placeholder="alex@company.com"
              value={form.email}
              onChange={(event) => onFieldChange('email', event.target.value)}
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'account-email-error' : undefined}
              disabled={isLoading}
            />
          </div>
          {errors.email ? <small id="account-email-error" role="alert">{errors.email}</small> : null}
        </div>

        <div className="account-field">
          <div className="account-label-row">
            <label htmlFor="account-role">Role</label>
            <span className="account-role-hint" title="Assign operational permissions for this user">
              <HelpCircle size={13} aria-hidden="true" />
              <span>Role permissions</span>
            </span>
          </div>
          <div className="account-input-wrap">
            <Shield size={16} className="input-inset-icon" aria-hidden="true" />
            <select
              id="account-role"
              name="role"
              value={form.role}
              onChange={(event) => onFieldChange('role', event.target.value)}
              autoComplete="off"
              aria-invalid={Boolean(errors.role)}
              aria-describedby={errors.role ? 'account-role-error' : undefined}
              disabled={isLoading || roles.length === 0}
            >
              <option value="">Select a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.name}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          {errors.role ? <small id="account-role-error" role="alert">{errors.role}</small> : null}
        </div>

        <div className="account-form-footer">
          {onClose && (
            <button
              type="button"
              className="btn btn-secondary account-cancel-btn"
              onClick={onClose}
              disabled={isLoading || isSubmitting}
            >
              Cancel
            </button>
          )}
          <button
            className="btn btn-primary account-submit"
            type="submit"
            disabled={isLoading || isSubmitting}
          >
            {isSubmitting ? (
              <LoaderCircle className="spin-icon" size={16} aria-hidden="true" />
            ) : (
              <UserPlus size={16} aria-hidden="true" />
            )}
            <span>{isSubmitting ? 'Adding...' : 'Add user'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
