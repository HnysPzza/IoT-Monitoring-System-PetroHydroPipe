import { Users } from 'lucide-react'

export default function RoleSummary({ accountCount, isLoading, roleCounts }) {
  return (
    <aside className="section-card role-summary-card" aria-labelledby="role-summary-title">
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">Access summary</p>
          <h2 id="role-summary-title">Accounts by role</h2>
        </div>
        <span className="section-chip">
          <Users size={16} aria-hidden="true" />
          {accountCount} total
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
  )
}
