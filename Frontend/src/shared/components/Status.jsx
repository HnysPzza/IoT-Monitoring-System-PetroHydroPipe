import './status.css'

export default function Status({ children, value = children, tone, className = '', ...props }) {
  const status = typeof value === 'string' ? value.toLowerCase() : ''
  const danger = tone === 'danger' || ['expired', 'error', 'fault', 'downtime', 'overdue', 'rejected'].includes(status)
  const dot = danger ? 'danger'
    : ['active', 'running', 'ok', 'connected'].includes(status) ? 'active'
      : status === 'idle' ? 'idle' : 'neutral'

  return (
    <span className={`status ${danger ? 'status-danger' : ''} ${className}`.trim()} {...props}>
      <span className={`status-dot status-dot-${dot}`} aria-hidden="true" />
      {children}
    </span>
  )
}
