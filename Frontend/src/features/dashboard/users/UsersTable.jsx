import Status from '../../../shared/components/Status.jsx'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Mail,
  MoreHorizontal,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react'
import { formatDate, getInitials } from './usersUtils.js'
import { getRoleDisplayName } from '../../../shared/constants/roleLabels.js'

export default function UsersTable({
  accounts,
  archivingUserId,
  busy,
  currentUserId,
  direction = 'desc',
  isLoading,
  onArchiveAccount,
  onPageChange,
  onRequestArchive,
  onRequestDeactivate,
  onResend,
  onResetPassword,
  onStatusChange,
  page = 1,
  pageSize = 10,
  sort = 'created',
  totalCount = 0,
  totalPages = 1,
  updatingUserId,
}) {
  const handleArchive = onRequestArchive || onArchiveAccount
  const handleDeactivate = onRequestDeactivate || onStatusChange
  const handleMenuKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll('.user-actions-item:not(:disabled)'))
    if (!items.length) return
    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement)
    if (event.key === 'Home') {
      items[0].focus()
      return
    }
    if (event.key === 'End') {
      items[items.length - 1].focus()
      return
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = currentIndex === -1
      ? (delta > 0 ? 0 : items.length - 1)
      : (currentIndex + delta + items.length) % items.length
    items[nextIndex].focus()
  }
  const columnHeader = (key, label) => (
    <th scope="col" aria-sort={sort === key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}
    </th>
  )

  return (
    <div className="users-table-content">
      <div className="account-table-wrap">
        <table className="account-table">
          <thead>
            <tr>
              {columnHeader('name', 'User')}
              {columnHeader('role', 'Role')}
              {columnHeader('status', 'Status')}
              <th scope="col">Onboarding</th>
              {columnHeader('created', 'Created')}
              <th scope="col">Last login</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="7" className="table-empty-message">Loading user accounts...</td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan="7" className="table-empty-message">No matching user accounts. Try clearing the filters.</td>
              </tr>
            ) : (
              accounts.map((account) => {
                const isCurrentUser = account.id === currentUserId || account.role === 'Admin'
                const isActionBusy = busy || updatingUserId === account.id || archivingUserId === account.id

                return (
                  <tr key={account.id}>
                    <td data-label="User">
                      <div className="user-identity-cell">
                        <div className="user-avatar" aria-hidden="true">
                          {getInitials(account.name, account.username)}
                        </div>
                        <div className="user-text-info">
                          <span className="user-display-name">{account.name}</span>
                          <span className="user-handles">@{account.username} · {account.email}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Role">
                      <div className="user-role-wrap">
                        <span className="user-role-text">{getRoleDisplayName(account.role)}</span>
                        {account.role === 'Admin' ? (
                          <span className="protected-badge" title="Protected Managing Director account">
                            <ShieldCheck size={12} aria-hidden="true" />
                            <span>Protected</span>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td data-label="Status">
                      <Status tone={account.status === 'Active' ? 'active' : 'offline'}>{account.status}</Status>
                    </td>
                    <td data-label="Onboarding">
                      {account.mustChangePassword ? (
                        <Status tone="fault">Password change required</Status>
                      ) : account.onboarding === 'Invited' ? (
                        <Status tone="fault">Invited</Status>
                      ) : account.onboarding === 'Expired' ? (
                        <Status tone="danger">Expired</Status>
                      ) : (
                        <Status>{account.onboarding === 'Ready' ? 'Complete' : account.onboarding || 'Complete'}</Status>
                      )}
                    </td>
                    <td data-label="Created" className={account.createdAt ? 'user-date' : 'user-date user-date-empty'}>{formatDate(account.createdAt)}</td>
                    <td data-label="Last login" className={account.lastLoginAt ? 'user-date' : 'user-date user-date-empty'}>{formatDate(account.lastLoginAt)}</td>
                    <td data-label="Actions">
                      <PopoverPrimitive.Root>
                        <PopoverPrimitive.Trigger asChild>
                          <button
                            className="user-action-trigger"
                            type="button"
                            aria-label={`Actions for ${account.name || account.username}`}
                            title={isCurrentUser ? 'Protected account actions are disabled' : undefined}
                            disabled={isActionBusy || isCurrentUser}
                          >
                            <MoreHorizontal size={18} aria-hidden="true" />
                          </button>
                        </PopoverPrimitive.Trigger>
                        <PopoverPrimitive.Portal>
                          <PopoverPrimitive.Content
                            className="user-actions-menu"
                            align="end"
                            sideOffset={6}
                            aria-label={`Actions menu for ${account.name || account.username}`}
                            onKeyDown={handleMenuKeyDown}
                          >
                            {['Invited', 'Expired'].includes(account.onboarding) && account.status === 'Active' ? (
                              <PopoverPrimitive.Close asChild>
                                <button
                                  className="user-actions-item"
                                  type="button"
                                  onClick={() => onResend(account)}
                                  disabled={isActionBusy}
                                >
                                  <Mail size={15} aria-hidden="true" />
                                  <span>Resend setup link</span>
                                </button>
                              </PopoverPrimitive.Close>
                            ) : null}

                            {account.onboarding === 'Ready' && account.status === 'Active' ? (
                              <PopoverPrimitive.Close asChild>
                                <button
                                  className="user-actions-item"
                                  type="button"
                                  onClick={() => onResetPassword?.(account)}
                                  disabled={isActionBusy || isCurrentUser}
                                  title={isCurrentUser ? 'Protected account cannot be reset' : undefined}
                                >
                                  <KeyRound size={15} aria-hidden="true" />
                                  <span>Send password reset link</span>
                                </button>
                              </PopoverPrimitive.Close>
                            ) : null}

                            {account.status === 'Active' ? (
                              <PopoverPrimitive.Close asChild>
                                <button
                                  className="user-actions-item user-actions-item-danger"
                                  type="button"
                                  onClick={() => handleDeactivate(account)}
                                  disabled={isActionBusy || isCurrentUser}
                                  title={isCurrentUser ? 'Protected account cannot be deactivated' : undefined}
                                >
                                  <UserX size={15} aria-hidden="true" />
                                  <span>Deactivate account</span>
                                </button>
                              </PopoverPrimitive.Close>
                            ) : (
                              <PopoverPrimitive.Close asChild>
                                <button
                                  className="user-actions-item user-actions-item-success"
                                  type="button"
                                  onClick={() => onStatusChange(account)}
                                  disabled={isActionBusy || isCurrentUser}
                                >
                                  <UserCheck size={15} aria-hidden="true" />
                                  <span>Activate account</span>
                                </button>
                              </PopoverPrimitive.Close>
                            )}

                            <PopoverPrimitive.Close asChild>
                              <button
                                className="user-actions-item user-actions-item-danger"
                                type="button"
                                onClick={() => handleArchive(account)}
                                disabled={isActionBusy || isCurrentUser}
                                title={isCurrentUser ? 'Protected account cannot be archived' : undefined}
                              >
                                <Archive size={15} aria-hidden="true" />
                                <span>Archive account</span>
                              </button>
                            </PopoverPrimitive.Close>

                            {isCurrentUser ? (
                              <div className="user-actions-protected-hint">
                                <ShieldCheck size={12} aria-hidden="true" />
                                <span>Account is protected</span>
                              </div>
                            ) : null}
                          </PopoverPrimitive.Content>
                        </PopoverPrimitive.Portal>
                      </PopoverPrimitive.Root>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 0 && onPageChange ? (
        <nav className="users-pagination" aria-label="Account directory pages">
          <div className="users-pagination-info">
            <span aria-live="polite">
              Showing {totalCount === 0 ? 0 : ((page || 1) - 1) * pageSize + 1}–{Math.min(((page || 1) - 1) * pageSize + accounts.length, totalCount)} of {totalCount} accounts
            </span>
          </div>
          <div className="users-pagination-actions">
            <button
              className="btn btn-secondary users-pagination-btn"
              disabled={isLoading || busy || (page || 1) <= 1}
              onClick={() => onPageChange((page || 1) - 1)}
              type="button"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              <span>Previous</span>
            </button>
            <button
              className="btn btn-secondary users-pagination-btn"
              disabled={isLoading || busy || (page || 1) >= totalPages}
              onClick={() => onPageChange((page || 1) + 1)}
              type="button"
            >
              <span>Next</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
