import { formatDate, getAccountStatusClass } from './usersUtils.js'

export default function UsersTable({ accounts, archivingUserId, currentUserId, isLoading, onArchiveAccount, onStatusChange, updatingUserId }) {
  return (
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
              <th scope="col">Actions</th>
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
                // The action button toggles to the opposite status for the selected account.
                const isCurrentUser = account.id === currentUserId
                const nextStatus = account.status === 'Active' ? 'Inactive' : 'Active'
                const actionClass = nextStatus === 'Active' ? 'table-action-activate' : 'table-action-deactivate'

                return (
                  <tr key={account.id}>
                    <td>{account.name}</td>
                    <td>{account.username}</td>
                    <td>{account.email}</td>
                    <td>{account.role}</td>
                    <td>
                      <span className={`status-badge ${getAccountStatusClass(account.status)}`}>{account.status}</span>
                    </td>
                    <td>{formatDate(account.createdAt)}</td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>
                      <div className="table-action-group">
                        <button
                          className={`btn btn-secondary table-action-button ${actionClass}`}
                          type="button"
                          onClick={() => onStatusChange(account)}
                          disabled={updatingUserId === account.id || archivingUserId === account.id || (isCurrentUser && nextStatus === 'Inactive')}
                        >
                          {updatingUserId === account.id ? 'Updating...' : nextStatus}
                        </button>
                        <button
                          className="btn btn-secondary table-action-button table-action-archive"
                          type="button"
                          onClick={() => onArchiveAccount(account)}
                          disabled={isCurrentUser || updatingUserId === account.id || archivingUserId === account.id}
                        >
                          {archivingUserId === account.id ? 'Archiving...' : 'Archive'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
