import { useLayoutEffect, useRef } from 'react'
import { LogOut } from 'lucide-react'

export default function LogoutConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  triggerButtonRef,
}) {
  const dialogRef = useRef(null)
  const cancelButtonRef = useRef(null)
  const shouldRestoreFocusRef = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      shouldRestoreFocusRef.current = true
      if (!dialog.hasAttribute('open')) {
        if (typeof dialog.showModal === 'function') dialog.showModal()
        else dialog.setAttribute('open', '')
      }
      cancelButtonRef.current?.focus({ preventScroll: true })
    } else if (dialog.hasAttribute('open')) {
      shouldRestoreFocusRef.current = false
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [isOpen])

  function handleDialogClose() {
    onClose()
    if (!shouldRestoreFocusRef.current) return
    shouldRestoreFocusRef.current = false
    if (triggerButtonRef.current?.isConnected) {
      triggerButtonRef.current.focus({ preventScroll: true })
    }
  }

  function handleCancelClick() {
    const dialog = dialogRef.current
    if (dialog?.hasAttribute('open') && typeof dialog.close === 'function') {
      dialog.close()
      return
    }
    handleDialogClose()
  }

  function handleConfirmClick() {
    shouldRestoreFocusRef.current = false
    const dialog = dialogRef.current
    if (dialog?.hasAttribute('open') && typeof dialog.close === 'function') {
      dialog.close()
    } else {
      onClose()
    }
    onConfirm()
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="logout-confirm-title"
      aria-describedby="logout-confirm-message"
      onClose={handleDialogClose}
    >
      {isOpen ? (
        <div className="confirm-dialog-content">
          <div className="confirm-dialog-header">
            <div className="confirm-dialog-icon danger">
              <LogOut size={17} aria-hidden="true" />
            </div>
            <div>
              <h3 id="logout-confirm-title" className="confirm-dialog-title">Log out</h3>
              <p id="logout-confirm-message" className="confirm-dialog-message">
                Are you sure you want to logout?
              </p>
            </div>
          </div>
          <div className="confirm-dialog-actions">
            <button
              ref={cancelButtonRef}
              type="button"
              className="btn btn-secondary confirm-cancel-btn"
              onClick={handleCancelClick}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleConfirmClick}
            >
              Yes
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  )
}
