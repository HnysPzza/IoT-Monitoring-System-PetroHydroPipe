import './status.css'

export default function Status({ children, value = children, tone, className = '', ...props }) {
  const rawValue = Array.isArray(value) ? value.join('') : value
  const status = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : ''
  const danger = tone === 'danger' || ['expired', 'error', 'downtime', 'overdue', 'rejected', 'invalid'].includes(status)
  const offline = !danger && (tone === 'offline' || status.startsWith('last:') || ['offline', 'disabled', 'inactive', 'watchdog unknown'].includes(status))
  const fault = !danger && !offline && (tone === 'fault' || ['fault', 'watchdog observe'].includes(status))
  const active = !danger && !offline && !fault && (tone === 'active' || ['active', 'running', 'ok', 'connected', 'resolved', 'watchdog enforce'].includes(status))
  const dot = danger ? 'danger'
    : offline ? 'offline'
      : fault ? 'fault'
        : active ? 'active'
          : status === 'idle' ? 'idle' : 'neutral'
  const statusToneClass = danger ? 'status-danger'
    : offline ? 'status-offline'
      : fault ? 'status-fault'
        : active ? 'status-active'
          : ''

  return (
    <span className={`status ${statusToneClass} ${className}`.trim()} {...props}>
      <span className={`status-dot status-dot-${dot}`} aria-hidden="true" />
      {children}
    </span>
  )
}
