import { AlertCircle, CheckCircle2 } from 'lucide-react'

export default function UsersNotice({ notice }) {
  if (!notice) {
    return null
  }

  return (
    <div className={`notice notice-${notice.type} dashboard-alert users-notice`} role={notice.type === 'error' ? 'alert' : 'status'}>
      {notice.type === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
      <span>{notice.message}</span>
    </div>
  )
}
