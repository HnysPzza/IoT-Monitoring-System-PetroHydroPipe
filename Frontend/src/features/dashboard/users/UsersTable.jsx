import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  KeyRound,
  Mail,
  MoreHorizontal,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react'
import { formatDate, getInitials } from './usersUtils.js'

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
  onSortChange,
  onStatusChange,
  page = 1,
  sort = 'created',
  totalCount = 0,
  totalPages = 1,
  updatingUserId,
}) {
  const handleArchive = onRequestArchive || onArchiveAccount
  const handleDeactivate = onRequestDeactivate || onStatusChange

  function handleHeaderSort(columnKey) {
    if (!onSortChange) return
    if (sort === columnKey) {
      onSortChange(columnKey, direction === 'asc' ? 'desc' : 'asc')
    } else {
      onSortChange(columnKey, columnKey === 'created' ? 'desc' : 'asc')
    }
  }

  function renderSortableTh(columnKey, label) {
    const isSorted = sort === columnKey
    return (
      <th scope="col" aria-sort={isSorted ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          className={`th-sort-button ${isSorted ? 'is-sorted' : ''}`}
          onClick={() => handleHeaderSort(columnKey)}
          aria-label={`Sort by ${label}${isSorted ? ` (${direction === 'asc' ? 'ascending' : 'descending'})` : ''}`}
        >
          <span>{label}</span>
          {isSorted ? (
            direction === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />
          ) : (
            <ArrowUpDown size={14} className="th-sort-idle" aria-hidden="true" />
          )}
        </button>
      </th>
    )
  }

  return (
    <div className="users-table-card" aria-label="User accounts directory">
      <div className="account-table-wrap">
        <table className="account-table">
          <thead>
            <tr>
              {renderSortableTh('name', 'User')}
              {renderSortableTh('role', 'Role')}
              {renderSortableTh('status', 'Status')}
              <th scope="col">Setup</th>
              {renderSortableTh('created', 'Created')}
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
                    <td>
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
                    <td>
                      <div className="user-role-wrap">
                        <span className="user-role-text">{account.role}</span>
                        {account.role === 'Admin' ? (
                          <span className="protected-badge" title="Protected Admin account">
                            <ShieldCheck size={12} aria-hidden="true" />
                            <span>Protected Admin</span>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill-badge ${account.status === 'Active' ? 'status-pill-active' : 'status-pill-inactive'}`}>
                        <span className={`status-pill-dot ${account.status === 'Active' ? 'dot-active' : 'dot-inactive'}`} aria-hidden="true" />
                        <span>{account.status}</span>
                      </span>
                    </td>
                    <td>
                      {account.mustChangePassword ? (
                        <span className="setup-pill-badge setup-pill-warning">
                          <KeyRound size={13} aria-hidden="true" />
                          <span>Password change required</span>
                        </span>
                      ) : account.onboarding === 'Invited' ? (
                        <span className="setup-pill-badge setup-pill-invited">
                          <Clock size={13} aria-hidden="true" />
                          <span>Invited</span>
                        </span>
                      ) : account.onboarding === 'Expired' ? (
                        <span className="setup-pill-badge setup-pill-expired">
                          <AlertCircle size={13} aria-hidden="true" />
                          <span>Expired</span>
                        </span>
                      ) : (
                        <span className="setup-pill-badge setup-pill-ready">
                          <CheckCircle2 size={13} aria-hidden="true" />
                          <span>{account.onboarding || 'Ready'}</span>
                        </span>
                      )}
                    </td>
                    <td>{formatDate(account.createdAt)}</td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>
                      <PopoverPrimitive.Root>
                        <PopoverPrimitive.Trigger asChild>
                          <button
                            className="user-action-trigger"
                            type="button"
                            aria-label={`Actions for ${account.name || account.username}`}
                            disabled={isActionBusy}
                          >
                            <MoreHorizontal size={18} aria-hidden="true" />
                          </button>
                        </PopoverPrimitive.Trigger>
                        <PopoverPrimitive.Portal>
                          <PopoverPrimitive.Content
                            className="user-actions-menu"
                            align="end"
                            sideOffset={6}
                            role="menu"
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
          <div className="pagination-info">
            <span aria-live="polite">
              Page {page || 1} of {totalPages} · {totalCount} accounts
            </span>
          </div>
          <div className="pagination-actions">
            <button
              className="btn btn-secondary pagination-btn"
              disabled={isLoading || (page || 1) <= 1}
              onClick={() => onPageChange((page || 1) - 1)}
              type="button"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              <span>Previous</span>
            </button>
            <button
              className="btn btn-secondary pagination-btn"
              disabled={isLoading || (page || 1) >= totalPages}
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
