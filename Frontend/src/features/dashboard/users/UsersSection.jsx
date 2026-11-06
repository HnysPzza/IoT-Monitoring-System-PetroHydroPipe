import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Search,
  RotateCw,
  UserPlus,
  X,
} from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { useAuthenticatedQuery } from '../../../shared/hooks/useAuthenticatedQuery.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { getRoleDisplayName } from '../../../shared/constants/roleLabels.js'
import { useUsersAction } from './UsersActionProvider.jsx'
import UserAccountForm from './UserAccountForm.jsx'
import UsersNotice from './UsersNotice.jsx'
import UsersTable from './UsersTable.jsx'
import { archiveUser, createUser, getRoles, getUsers, resendSetup, sendPasswordReset, updateUserStatus } from './usersService.js'
import { initialUserForm, normalizeUsername, validateAccount } from './usersUtils.js'
import './users.css'

const initialQuery = { page: 1, limit: 10, search: '', role: '', status: '', sort: 'created', direction: 'desc' }

function applyPendingAction(payload, pendingAction, query) {
  if (!pendingAction) return payload

  const removesFromResults = pendingAction.type === 'archive'
    || (pendingAction.type === 'deactivate' && query.status === 'Active')
  const users = removesFromResults
    ? payload.users.filter((account) => account.id !== pendingAction.account.id)
    : payload.users.map((account) => account.id === pendingAction.account.id
      ? { ...account, status: 'Inactive' }
      : account)

  return {
    ...payload,
    users,
    total: removesFromResults ? Math.max(0, payload.total - 1) : payload.total,
  }
}

export default function UsersSection() {
  const { token, user } = useAuth()
  const { pendingAction, scheduleAccountAction } = useUsersAction()
  const queryClient = useQueryClient()
  const online = useNetworkOnline()
  const [query, setQuery] = useState(initialQuery)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(initialUserForm)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const [isMutating, setIsMutating] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const busy = isMutating || Boolean(pendingAction)
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
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const rolesQuery = useAuthenticatedQuery({
    queryKey: queryKeys.users.roles,
    queryFn: ({ token: currentToken, signal }) => getRoles(currentToken, signal),
    staleTime: 300000,
  })
  const usersQuery = useAuthenticatedQuery({
    queryKey: queryKeys.users.list(query),
    queryFn: ({ token: currentToken, signal }) => getUsers(currentToken, query, signal),
    staleTime: 30000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })
  const roles = rolesQuery.data?.roles || []
  const directory = applyPendingAction(usersQuery.data || { users: [], total: 0 }, pendingAction, query)
  const isLoading = usersQuery.isPending && !usersQuery.data
  const loadError = usersQuery.error?.message || (rolesQuery.isError ? rolesQuery.error?.message : '') || (!online && usersQuery.data ? 'Unable to refresh while offline.' : '')
  const staleNotice = loadError && usersQuery.data ? `Account data is stale.${usersQuery.isPlaceholderData ? ' Showing previous filter results.' : ''}${usersQuery.dataUpdatedAt ? ` Last updated ${new Date(usersQuery.dataUpdatedAt).toLocaleString()}.` : ''} ${loadError}` : ''
  useEffect(() => {
    if (!usersQuery.data || usersQuery.isPlaceholderData) return
    const lastPage = Math.max(1, Math.ceil(usersQuery.data.total / query.limit))
    if (query.page > lastPage) setQuery((current) => ({ ...current, page: lastPage }))
  }, [usersQuery.data, usersQuery.isPlaceholderData, query.limit, query.page])

  function filter(field, value) {
    setQuery((current) => ({ ...current, [field]: value, page: 1 }))
  }

  async function runMutation(action, success, unconfirmedMessage = 'Account saved, but email delivery is unconfirmed. Check the inbox, or resend after one minute. Do not add the account again.') {
    if (mutation.current) return false
    mutation.current = true
    setIsMutating(true)
    setNotice(null)
    try {
      const payload = await action()
      setNotice({ type: payload.delivery === 'unconfirmed' ? 'error' : 'success', message: payload.delivery === 'unconfirmed'
        ? unconfirmedMessage
        : success })
      return true
    } catch (error) {
      setNotice({ type: 'error', message: `${error.message} If the request timed out, check the directory before retrying.` })
      return false
    } finally {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all })
      mutation.current = false
      setIsMutating(false)
    }
  }

  function stageAccountAction(type, account) {
    if (pendingAction || mutation.current) return

    const removesFromResults = type === 'archive' || (type === 'deactivate' && query.status === 'Active')
    if (!scheduleAccountAction(type, account, removesFromResults)) return

    void queryClient.cancelQueries({ queryKey: queryKeys.users.all })

    setNotice(null)
    confirmDialog.current?.close()
    setConfirmAction(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const nextErrors = validateAccount(form, [])
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const saved = await runMutation(() => createUser(token, {
      ...form, name: form.name.trim(), username: normalizeUsername(form.username), email: form.email.trim().toLowerCase(),
    }), 'Invitation sent. Brevo accepted the email; inbox delivery is not guaranteed.')
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
  const [headerSlot, setHeaderSlot] = useState(() => document.getElementById('users-header-controls'))
  useLayoutEffect(() => {
    const slot = document.getElementById('users-header-controls')
    if (slot !== headerSlot) setHeaderSlot(slot)
  })
  const resolvedHeaderSlot = headerSlot?.isConnected ? headerSlot : document.getElementById('users-header-controls')
  const headerControls = (
    <div className="users-header-controls">
      {!isLoading && !loadError ? <span className="users-count">{directory.total} {hasActiveFilters ? 'matching' : 'staff'} accounts</span> : null}
      <button className="icon-button users-refresh" type="button" aria-label="Refresh accounts" title="Refresh accounts" disabled={isLoading || busy} onClick={() => usersQuery.refetch()}>
        <RotateCw size={15} aria-hidden="true" />
      </button>
    </div>
  )

  if (!online && !usersQuery.data) return <div role="alert">Unable to refresh while offline. <button type="button" onClick={() => usersQuery.refetch()}>Retry</button></div>

  return (
    <div className="users-directory">
      <UsersNotice notice={notice} onDismiss={() => setNotice(null)} />
      {resolvedHeaderSlot ? createPortal(headerControls, resolvedHeaderSlot) : headerControls}

      <section className="section-card users-directory-card" aria-label="Staff accounts">
        <div className="users-filters-card" aria-label="User account filters">
        <div className="users-filters">
          <label className="filter-field users-search-field" htmlFor="users-search-input">
            <span className="sr-only">Search</span>
            <div className="users-search-control">
              <Search size={16} className="users-search-icon" aria-hidden="true" />
              <input
                type="search"
                id="users-search-input"
                value={search}
                maxLength={100}
                placeholder="Search by name, username, or email..."
                disabled={busy}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>

          <label className="filter-field" htmlFor="users-filter-role">
            <span className="sr-only">Role</span>
            <select
              id="users-filter-role"
              value={query.role}
              disabled={busy}
              onChange={(event) => filter('role', event.target.value)}
            >
              <option value="">All roles</option>
              {roles.map((role) => <option key={role.id} value={role.name}>{getRoleDisplayName(role.name)}</option>)}
            </select>
          </label>

          <label className="filter-field" htmlFor="users-filter-status">
            <span className="sr-only">Status</span>
            <select
              id="users-filter-status"
              value={query.status}
              disabled={busy}
              onChange={(event) => filter('status', event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>

          <label className="filter-field users-sort-field" htmlFor="users-filter-sort">
            <span className="sr-only">Sort</span>
            <select
              id="users-filter-sort"
              value={`${query.sort}-${query.direction}`}
              disabled={busy}
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
              disabled={busy}
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
        </div>

        {staleNotice ? <div role="alert">{staleNotice} <button type="button" onClick={() => usersQuery.refetch()}>Retry</button></div> : null}
        {usersQuery.isFetching && usersQuery.data ? <div role="status">{usersQuery.isPlaceholderData ? 'Loading selected filters; previous results remain visible.' : 'Refreshing accounts...'}</div> : null}
        {loadError && !usersQuery.data ? (
          <div className="users-load-error" role="alert">
            <p>{loadError}</p>
            <button className="btn btn-secondary" type="button" onClick={() => usersQuery.refetch()}>Retry loading</button>
          </div>
        ) : (
          <UsersTable
            accounts={directory.users}
            currentUserId={user?.id}
            sort={query.sort}
            direction={query.direction}
            isLoading={isLoading}
            busy={busy || usersQuery.isPlaceholderData}
            page={query.page}
            totalPages={pages}
            totalCount={directory.total}
            pageSize={query.limit}
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
            onResetPassword={(account) => runMutation(
              () => sendPasswordReset(token, account.id),
              'Password reset email accepted by Brevo. Inbox delivery is not guaranteed.',
              'Password reset link was created, but email delivery is unconfirmed. Check delivery status before retrying.',
            )}
          />
        )}
      </section>

      {/* Account Creation Modal */}
      <dialog className="users-dialog" ref={dialog} aria-labelledby="create-account-title" onCancel={(event) => { if (busy) event.preventDefault() }}>
        <UsersNotice notice={notice} onDismiss={() => setNotice(null)} />
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
                onClick={() => {
                  const { type, account } = confirmAction
                  stageAccountAction(type, account)
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
