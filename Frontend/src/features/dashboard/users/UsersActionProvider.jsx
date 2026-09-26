import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Undo2, X } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { archiveUser, updateUserStatus } from './usersService.js'
import './users-action.css'

const ACCOUNT_ACTION_UNDO_MS = 7000
const UsersActionContext = createContext(null)

export function useUsersAction() {
  const context = useContext(UsersActionContext)
  if (!context) throw new Error('useUsersAction must be used inside UsersActionProvider.')
  return context
}

export default function UsersActionProvider({ children }) {
  const { token } = useAuth()
  const [pendingAction, setPendingAction] = useState(null)
  const [notice, setNotice] = useState(null)
  const [revision, setRevision] = useState(0)
  const pendingActionRef = useRef(null)
  const actionTimer = useRef(null)
  const noticeTimer = useRef(null)
  const undoButton = useRef(null)

  useEffect(() => {
    if (!notice) return undefined
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(noticeTimer.current)
  }, [notice])

  useEffect(() => () => window.clearTimeout(actionTimer.current), [])

  useEffect(() => {
    if (pendingAction?.phase === 'undo' && pendingAction.removesFromResults) {
      undoButton.current?.focus()
    }
  }, [pendingAction])

  function scheduleAccountAction(type, account, removesFromResults) {
    if (pendingActionRef.current) return false

    const pending = { type, account, removesFromResults, startedAt: Date.now(), phase: 'undo' }
    pendingActionRef.current = pending
    setPendingAction(pending)
    setNotice(null)
    window.clearTimeout(noticeTimer.current)

    actionTimer.current = window.setTimeout(async () => {
      actionTimer.current = null
      if (pendingActionRef.current !== pending) return

      const committing = { ...pending, phase: 'saving' }
      pendingActionRef.current = committing
      setPendingAction(committing)

      let nextNotice
      try {
        const payload = type === 'archive'
          ? await archiveUser(token, account.id)
          : await updateUserStatus(token, account.id, 'Inactive')
        nextNotice = payload.delivery === 'unconfirmed'
          ? { type: 'error', message: 'Account saved, but email delivery is unconfirmed. Check the inbox, or resend after one minute. Do not add the account again.' }
          : { type: 'success', message: type === 'archive' ? 'Account archived.' : 'Account deactivated.' }
      } catch (error) {
        nextNotice = { type: 'error', message: `${error.message} If the request timed out, check the directory before retrying.` }
      } finally {
        if (pendingActionRef.current === committing) pendingActionRef.current = null
        setPendingAction(null)
        setRevision((current) => current + 1)
        setNotice(nextNotice)
      }
    }, ACCOUNT_ACTION_UNDO_MS)

    return true
  }

  function undoAccountAction() {
    if (pendingActionRef.current?.phase !== 'undo') return

    window.clearTimeout(actionTimer.current)
    actionTimer.current = null
    pendingActionRef.current = null
    setPendingAction(null)
    setRevision((current) => current + 1)
  }

  const message = pendingAction
    ? pendingAction.phase === 'saving'
      ? `Saving account changes for ${pendingAction.account.name || pendingAction.account.username}…`
      : `${pendingAction.account.name || pendingAction.account.username} ${pendingAction.type === 'archive' ? 'archived' : 'deactivated'}. Undo available for 7 seconds.`
    : notice?.message

  return (
    <UsersActionContext.Provider value={{ pendingAction, revision, scheduleAccountAction }}>
      {children}
      {message ? (
        <div
          className="users-action-snackbar"
          role={pendingAction ? 'status' : notice.type === 'error' ? 'alert' : 'status'}
          aria-live={notice?.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          {pendingAction ? null : notice.type === 'error'
            ? <AlertCircle className="users-action-result-error" size={16} aria-hidden="true" />
            : <CheckCircle2 className="users-action-result-success" size={16} aria-hidden="true" />}
          <span className="users-action-snackbar-message">{message}</span>
          {pendingAction ? (
            <button
              className="users-action-undo"
              ref={undoButton}
              type="button"
              hidden={pendingAction.phase === 'saving'}
              aria-label={`Undo ${pendingAction.type} for ${pendingAction.account.name || pendingAction.account.username}`}
              onClick={undoAccountAction}
            >
              <Undo2 size={15} aria-hidden="true" />
              <span>Undo</span>
            </button>
          ) : (
            <button
              className="users-action-dismiss"
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
          {pendingAction?.phase === 'undo' ? (
            <span className="users-action-progress" aria-hidden="true">
              <span style={{ animationDuration: `${ACCOUNT_ACTION_UNDO_MS}ms` }} />
            </span>
          ) : null}
        </div>
      ) : null}
    </UsersActionContext.Provider>
  )
}
