import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Search,
  UserPlus,
  X,
} from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import UserAccountForm from './UserAccountForm.jsx'
import UsersNotice from './UsersNotice.jsx'
import UsersTable from './UsersTable.jsx'
import { archiveUser, createUser, getRoles, getUsers, resendSetup, updateUserStatus } from './usersService.js'
import { initialUserForm, normalizeUsername, validateAccount } from './usersUtils.js'
import './users.css'

const initialQuery = { page: 1, limit: 10, search: '', role: '', status: '', sort: 'created', direction: 'desc' }

export default function UsersSection() {
  const { token, user } = useAuth()
  const [directory, setDirectory] = useState({ users: [], total: 0 })
  const [roles, setRoles] = useState([])
  const [query, setQuery] = useState(initialQuery)
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [form, setForm] = useState(initialUserForm)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const dialog = useRef(null)
  const confirmDialog = useRef(null)
  const mutation = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => setQuery((current) => current.search === search
      ? current
      : { ...current, search, page: 1 }), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let active = true
    getRoles(token).then((payload) => {
      if (active) setRoles(payload.roles || [])
    }).catch((error) => {
      if (active) setNotice({ type: 'error', message: error.message })
    })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setLoadError('')
    getUsers(token, query, controller.signal).then((payload) => {
      if (controller.signal.aborted) return
      const lastPage = Math.max(1, Math.ceil(payload.total / query.limit))
      if (query.page > lastPage) {
        setQuery((current) => ({ ...current, page: lastPage }))
        return
      }
      setDirectory(payload)
    }).catch((error) => {
      if (!controller.signal.aborted) setLoadError(error.message || 'Unable to load accounts.')
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false)
    })
    return () => controller.abort()
  }, [token, query, revision])

  function filter(field, value) {
    setQuery((current) => ({ ...current, [field]: value, page: 1 }))
  }

  async function runMutation(action, success) {
    if (mutation.current) return false
    mutation.current = true
    setBusy(true)
    setNotice(null)
    try {
      const payload = await action()
      setNotice({ type: payload.delivery === 'unconfirmed' ? 'error' : 'success', message: payload.delivery === 'unconfirmed'
        ? 'Account saved, but email delivery is unconfirmed. Check the inbox, or resend after one minute. Do not add the account again.'
        : success })
      return true
    } catch (error) {
      setNotice({ type: 'error', message: `${error.message} If the request timed out, check the directory before retrying.` })
      return false
    } finally {
      setRevision((current) => current + 1)
      mutation.current = false
      setBusy(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const nextErrors = validateAccount(form, [])
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const saved = await runMutation(() => createUser(token, {
      ...form, name: form.name.trim(), username: normalizeUsername(form.username), email: form.email.trim().toLowerCase(),
    }), 'User added. Brevo accepted the setup email; inbox delivery is not guaranteed.')
    if (saved) {
      dialog.current.close()
      setForm(initialUserForm)
    }
  }

  function openForm() {
    setNotice(null)
    setErrors({})
    setForm(initialUserForm)
    dialog.current.showModal()
  }

  const hasActiveFilters = Boolean(
    search.trim() ||
    query.role ||
    query.status,
  )

  const pages = Math.max(1, Math.ceil(directory.total / query.limit))

  return (
    <div className="users-directory">
      <UsersNotice notice={notice} />

      <section className="section-card users-filters-card" aria-label="User account filters">
        <div className="users-filters">
          <label className="filter-field users-search-field" htmlFor="users-search-input">
            <span>Search</span>
            <div className="users-search-control">
              <Search size={16} className="users-search-icon" aria-hidden="true" />
              <input
                type="search"
                id="users-search-input"
                value={search}
                maxLength={100}
                placeholder="Search by name, username, or email..."
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>

          <label className="filter-field" htmlFor="users-filter-role">
            <span>Role</span>
            <select
              id="users-filter-role"
              value={query.role}
              onChange={(event) => filter('role', event.target.value)}
            >
              <option value="">All roles</option>
              {roles.map((role) => <option key={role.id}>{role.name}</option>)}
            </select>
          </label>

          <label className="filter-field" htmlFor="users-filter-status">
            <span>Status</span>
            <select
              id="users-filter-status"
              value={query.status}
              onChange={(event) => filter('status', event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>

          <button
            className="btn btn-secondary users-add-user"
            type="button"
            disabled={busy || !roles.length}
            onClick={openForm}
          >
            <UserPlus size={16} aria-hidden="true" />
            <span>Add user</span>
          </button>

          {hasActiveFilters && (
            <button
              className="btn btn-secondary users-clear-filters"
              type="button"
              onClick={() => {
                setSearch('')
                setQuery((current) => ({ ...current, page: 1, search: '', role: '', status: '' }))
              }}
            >
              <X size={15} aria-hidden="true" />
              <span>Clear filters</span>
            </button>
          )}
        </div>
      </section>

      <section className="section-card users-directory-card" aria-labelledby="users-directory-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Directory</p>
            <h2 id="users-directory-title">Staff accounts</h2>
          </div>
          <label className="filter-field users-sort-field" htmlFor="users-filter-sort">
            <span>Sort</span>
            <select
              id="users-filter-sort"
              value={`${query.sort}-${query.direction}`}
              onChange={(event) => {
                const [sort, direction] = event.target.value.split('-')
                setQuery((current) => ({ ...current, sort, direction, page: 1 }))
              }}
            >
              <option value="created-desc">Newest first</option>
              <option value="created-asc">Oldest first</option>
              <option value="name-asc">Name (A–Z)</option>
              <option value="name-desc">Name (Z–A)</option>
              <option value="role-asc">Role (A–Z)</option>
              <option value="status-asc">Status</option>
            </select>
          </label>
        </div>

        {loadError ? (
          <div className="users-load-error" role="alert">
            <p>{loadError}</p>
            <button className="btn btn-secondary" type="button" onClick={() => setRevision((current) => current + 1)}>Retry loading</button>
          </div>
        ) : (
          <UsersTable
            accounts={directory.users}
            currentUserId={user?.id}
            sort={query.sort}
            direction={query.direction}
            isLoading={isLoading}
            busy={busy}
            page={query.page}
            totalPages={pages}
            totalCount={directory.total}
            onPageChange={(page) => setQuery((current) => ({ ...current, page }))}
            onRequestDeactivate={(account) => {
              setConfirmAction({ type: 'deactivate', account })
              confirmDialog.current?.showModal()
            }}
            onRequestArchive={(account) => {
              setConfirmAction({ type: 'archive', account })
              confirmDialog.current?.showModal()
            }}
            onStatusChange={(account) => {
              runMutation(
                () => updateUserStatus(token, account.id, 'Active'),
                'Account is now Active.',
              )
            }}
            onArchiveAccount={(account) => {
              runMutation(() => archiveUser(token, account.id), 'Account archived.')
            }}
            onResend={(account) => runMutation(() => resendSetup(token, account.id), 'New setup email accepted by Brevo. Previous setup links no longer work.')}
          />
        )}
      </section>

      {/* Account Creation Modal */}
      <dialog className="users-dialog" ref={dialog} aria-labelledby="create-account-title" onCancel={(event) => { if (busy) event.preventDefault() }}>
        <UsersNotice notice={notice} />
        <UserAccountForm
          form={form}
          errors={errors}
          roles={roles.filter((role) => role.name !== 'Admin')}
          isLoading={busy}
          isSubmitting={busy}
          onSubmit={handleSubmit}
          onClose={() => dialog.current?.close()}
          onFieldChange={(field, value) => {
            setForm((current) => ({ ...current, [field]: value }))
            setErrors((current) => ({ ...current, [field]: '' }))
          }}
        />
      </dialog>

      {/* Deactivate & Archive Confirmation Modal */}
      <dialog
        className="confirm-dialog"
        ref={confirmDialog}
        aria-labelledby="confirm-action-title"
        onCancel={(event) => { if (busy) event.preventDefault() }}
      >
        {confirmAction && (
          <div className="confirm-dialog-content">
            <div className="confirm-dialog-header">
              <div className="confirm-dialog-icon danger">
                <AlertTriangle size={22} aria-hidden="true" />
              </div>
              <div>
                <h3 id="confirm-action-title" className="confirm-dialog-title">
                  {confirmAction.type === 'deactivate' ? 'Deactivate user account' : 'Archive user account'}
                </h3>
                <p className="confirm-dialog-message">
                  {confirmAction.type === 'deactivate' ? (
                    <>
                      Are you sure you want to deactivate <strong>{confirmAction.account.name || confirmAction.account.username}</strong> (@{confirmAction.account.username})? Active sessions and setup links will be revoked.
                    </>
                  ) : (
                    <>
                      Are you sure you want to archive <strong>{confirmAction.account.name || confirmAction.account.username}</strong> (@{confirmAction.account.username})? This removes access and hides the account from the directory.
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  confirmDialog.current?.close()
                  setConfirmAction(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  const { type, account } = confirmAction
                  let success = false
                  if (type === 'deactivate') {
                    success = await runMutation(
                      () => updateUserStatus(token, account.id, 'Inactive'),
                      'Account is now Inactive. Reactivated pending accounts need a new setup link.',
                    )
                  } else {
                    success = await runMutation(
                      () => archiveUser(token, account.id),
                      'Account archived.',
                    )
                  }
                  if (success) {
                    confirmDialog.current?.close()
                    setConfirmAction(null)
                  }
                }}
              >
                {confirmAction.type === 'deactivate' ? 'Deactivate' : 'Archive'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  )
}
