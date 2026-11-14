import './status.css'

export default function Status({ children, value = children, tone, className = '', ...props }) {
  const status = typeof value === 'string' ? value.toLowerCase() : ''
  const danger = tone === 'danger' || ['expired', 'error', 'downtime', 'overdue', 'rejected'].includes(status)
  const offline = !danger && (tone === 'offline' || status.startsWith('last:') || status === 'offline')
  const fault = !danger && !offline && (tone === 'fault' || status === 'fault')
  const active = !danger && !offline && !fault && (tone === 'active' || ['active', 'running', 'ok', 'connected', 'resolved'].includes(status))
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
