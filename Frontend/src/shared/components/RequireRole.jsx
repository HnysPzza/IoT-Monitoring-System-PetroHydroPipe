import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'

export default function RequireRole({ roles, children }) {
  const { user } = useAuth()

  // Allows direct URL access only when the logged-in role is permitted.
  if (roles.includes(user?.role)) {
    return children
  }

  return (
    <section className="section-card permission-card" aria-labelledby="permission-title">
      <div className="permission-icon" aria-hidden="true">
        <ShieldAlert size={26} />
      </div>
      <div className="section-copy">
        <p className="section-eyebrow">Access control</p>
        <h1 id="permission-title">You do not have permission</h1>
        <p>
          Your role does not have access to this section. Sign in with a different account or return to an allowed
          dashboard view.
        </p>
      </div>
    </section>
  )
}
