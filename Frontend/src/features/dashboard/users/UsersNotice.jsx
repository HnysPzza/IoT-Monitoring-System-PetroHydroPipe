import { AlertCircle, CheckCircle2, X } from 'lucide-react'

export default function UsersNotice({ notice, onDismiss }) {
  if (!notice) {
    return null
  }

  return (
    <div className={`notice notice-${notice.type} dashboard-alert users-notice`}>
      {notice.type === 'error'
        ? <AlertCircle className="users-notice-icon-error" size={16} aria-hidden="true" />
        : <CheckCircle2 className="users-notice-icon-success" size={16} aria-hidden="true" />}
      <span role={notice.type === 'error' ? 'alert' : 'status'} aria-atomic="true">{notice.message}</span>
      <button className="users-notice-dismiss" type="button" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
