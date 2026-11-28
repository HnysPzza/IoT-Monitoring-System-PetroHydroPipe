import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { Bell, History, MoveRight, UserRoundCheck, X } from 'lucide-react'
import { useExitPresence } from '../../../shared/hooks/useExitPresence.js'
import { getAlertDestination, getAlertKind } from '../../../shared/utils/alertPresentation.js'
import UpdatedAgo from '../../../shared/components/UpdatedAgo.jsx'

const LONG_ALERT_THRESHOLD = 110

function getAlertStatusLabel(alert) {
  if (alert.status === 'Active' && alert.metadata?.recoveryPending) {
    return 'Recovered, waiting for acknowledgement'
  }

  return alert.status
}

export default function AlertsPopover({
  isOpen,
  onToggle,
  onClose,
  buttonRef,
  alerts,
  activeAlerts,
  acknowledgedAlerts,
  unresolvedAlerts,
  hasTrustedAlertList,
  cachedAlertsAt,
  alertLoadError,
  acknowledgingAlertIds,
  alertAcknowledgementErrors,
  onRetryAlerts,
  onAcknowledgeAlert,
}) {
  const [bellSwingState, setBellSwingState] = useState({ count: 0, isSwinging: false })
  const [expandedAlertIds, setExpandedAlertIds] = useState(() => new Set())
  const [ackStatusMessage, setAckStatusMessage] = useState('')

  const alertsPopoverRef = useRef(null)
  const previousActiveCountRef = useRef(null)
  const bellSwingTimerRef = useRef(null)
  const pendingFocusRestoreRef = useRef(null)

  const {
    isPresent: isAlertsPopoverPresent,
    isExiting: isAlertsPopoverExiting,
    handleAnimationEnd: handleAlertsPopoverAnimationEnd,
  } = useExitPresence(isOpen, alertsPopoverRef, 140)

  const activeAlertCount = activeAlerts.length
  const alertDestinations = Array.from(new Map(alerts.map((alert) => {
    const destination = getAlertDestination(alert)
    return [destination.to, destination]
  })).values())

  useEffect(() => {
    if (!isOpen) return undefined

    alertsPopoverRef.current?.focus({ preventScroll: true })

    function handlePointerDown(event) {
      if (alertsPopoverRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) {
        return
      }

      onClose()
    }

    function handleFocusTrap(event) {
      if (event.key !== 'Tab' || !alertsPopoverRef.current) return
      const focusable = Array.from(
        alertsPopoverRef.current.querySelectorAll(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        alertsPopoverRef.current.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === alertsPopoverRef.current)) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleFocusTrap)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleFocusTrap)
    }
  }, [isOpen, buttonRef, onClose])

  useEffect(() => {
    if (!hasTrustedAlertList) {
      previousActiveCountRef.current = null
      return undefined
    }

    const prevCount = previousActiveCountRef.current
    previousActiveCountRef.current = activeAlertCount

    const shouldSwing = activeAlertCount > 0 && !isOpen && (
      prevCount === null || activeAlertCount > prevCount
    )

    if (shouldSwing) {
      if (bellSwingTimerRef.current !== null) {
        clearTimeout(bellSwingTimerRef.current)
      }
      setBellSwingState((prev) => ({ count: prev.count + 1, isSwinging: true }))
      bellSwingTimerRef.current = setTimeout(() => {
        bellSwingTimerRef.current = null
        setBellSwingState((prev) => (prev.isSwinging ? { ...prev, isSwinging: false } : prev))
      }, 1150)
    } else if (activeAlertCount === 0 || isOpen) {
      if (bellSwingTimerRef.current !== null) {
        clearTimeout(bellSwingTimerRef.current)
        bellSwingTimerRef.current = null
      }
      setBellSwingState((prev) => (prev.isSwinging ? { ...prev, isSwinging: false } : prev))
    }

    return undefined
  }, [activeAlertCount, hasTrustedAlertList, isOpen])

  useEffect(() => () => {
    if (bellSwingTimerRef.current !== null) {
      clearTimeout(bellSwingTimerRef.current)
      bellSwingTimerRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const pending = pendingFocusRestoreRef.current
    if (!pending || !isOpen) return

    const stillActiveButton = alertsPopoverRef.current?.querySelector(`[data-alert-ack-id="${pending.alertId}"]`)
    if (stillActiveButton) return

    pendingFocusRestoreRef.current = null
    if (!pending.shouldRestoreFocus) return

    const container = alertsPopoverRef.current
    if (!container) return

    const buttons = Array.from(container.querySelectorAll('[data-alert-ack-id]'))
    if (buttons.length > 0) {
      const startIndex = pending.snapshotOrder.indexOf(pending.alertId)
      const nextId = startIndex >= 0
        ? pending.snapshotOrder
          .slice(startIndex + 1)
          .find((candidateId) => buttons.some((btn) => btn.getAttribute('data-alert-ack-id') === String(candidateId)))
        : null
      const targetButton = buttons.find((btn) => btn.getAttribute('data-alert-ack-id') === String(nextId))
        || buttons[buttons.length - 1]
      targetButton.focus({ preventScroll: true })
      return
    }

    const footerLink = container.querySelector('.alerts-popover-footer a')
    if (footerLink) {
      footerLink.focus({ preventScroll: true })
      return
    }
    container.focus({ preventScroll: true })
  }, [isOpen, unresolvedAlerts])

  function handleAcknowledge(alertId) {
    const wasFocused = typeof document !== 'undefined' && (
      document.activeElement?.getAttribute?.('data-alert-ack-id') === String(alertId)
      || (isOpen && document.activeElement === document.body)
    )
    const snapshotOrder = unresolvedAlerts.map((item) => item.id)

    void onAcknowledgeAlert(alertId, {
      onAcknowledged: (acknowledgedAlert) => {
        if (wasFocused || (typeof document !== 'undefined' && isOpen && document.activeElement === document.body)) {
          pendingFocusRestoreRef.current = { alertId, snapshotOrder, shouldRestoreFocus: true }
        }
        setAckStatusMessage(`Alert acknowledged: ${acknowledgedAlert?.title || acknowledgedAlert?.message || alertId}`)
      },
    })
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={`icon-button dashboard-icon-button notification-button ${activeAlertCount > 0 ? 'is-alerting' : ''}`}
        type="button"
        data-bell-swing={bellSwingState.isSwinging && !isOpen ? 'true' : 'false'}
        aria-label={
          !hasTrustedAlertList
            ? 'Open alerts, status unavailable'
            : activeAlertCount > 0
              ? `Open alerts, ${activeAlertCount} active`
              : 'Open alerts, none active'
        }
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <Bell
          key={`bell-${bellSwingState.count}`}
          className={`bell-icon ${bellSwingState.isSwinging && !isOpen ? 'is-swinging' : ''}`.trim()}
          size={20}
          aria-hidden="true"
          onAnimationEnd={() => setBellSwingState((prev) => (prev.isSwinging ? { ...prev, isSwinging: false } : prev))}
        />
        {hasTrustedAlertList && activeAlertCount > 0 ? (
          <span key={`badge-${activeAlertCount}`} className="notification-badge" aria-hidden="true">
            {activeAlertCount > 99 ? '99+' : activeAlertCount}
          </span>
        ) : null}
        <span className="sr-only">
          {!hasTrustedAlertList
            ? 'Alert status unavailable'
            : activeAlertCount > 0
              ? `${activeAlertCount} active alerts`
              : 'No active alerts'}
        </span>
      </button>
      {isAlertsPopoverPresent ? (
        <div
          ref={alertsPopoverRef}
          data-state={isOpen ? 'open' : 'closed'}
          inert={isAlertsPopoverExiting || undefined}
          onAnimationEnd={handleAlertsPopoverAnimationEnd}
          className="alerts-popover"
          role="dialog"
          aria-label="Active alerts"
          tabIndex="-1"
        >
          <div className="alerts-popover-header">
            <div className="alerts-header-title-wrap">
              <strong>Notifications</strong>
              <span
                className="alerts-header-count"
                aria-label={!hasTrustedAlertList ? 'Alert count unavailable' : `${activeAlertCount} active alerts`}
              >
                {hasTrustedAlertList ? (activeAlertCount > 99 ? '99+' : activeAlertCount) : '—'}
              </span>
            </div>
            <div className="alerts-header-actions">
              {hasTrustedAlertList && acknowledgedAlerts.length > 0 ? (
                <span className="alerts-header-acknowledged">
                  {acknowledgedAlerts.length} acknowledged
                </span>
              ) : null}
              <button
                type="button"
                className="alerts-popover-close-btn"
                aria-label="Close alerts"
                onClick={() => {
                  onClose()
                  buttonRef.current?.focus({ preventScroll: true })
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          {ackStatusMessage ? (
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {ackStatusMessage}
            </div>
          ) : null}
          {cachedAlertsAt && !hasTrustedAlertList ? (
            <div className="alert-load-error" role="status">Cached alerts are stale. Updated <UpdatedAgo updatedAt={cachedAlertsAt} />.</div>
          ) : null}
          {alertLoadError ? (
            <div className="alert-load-error" role="alert">
              <span>{alertLoadError}</span>
              <button className="btn btn-secondary" type="button" onClick={onRetryAlerts}>
                Retry
              </button>
            </div>
          ) : null}
          {alerts.length > 0 ? (
            <ul className="alerts-popover-list">
              {[...activeAlerts, ...acknowledgedAlerts].map((alert) => {
                const isAcked = alert.status === 'Acknowledged'
                const isRecoveryPending = alert.status === 'Active' && Boolean(alert.metadata?.recoveryPending)
                const statusLabel = getAlertStatusLabel(alert)
                const alertKind = getAlertKind(alert)
                const rowStateClass = isRecoveryPending
                  ? 'is-recovered'
                  : isAcked
                    ? 'is-acknowledged'
                    : 'is-active'
                const primaryText = alert.title || alert.message || ''
                const secondaryMessage = alert.title && alert.message && alert.title !== alert.message
                  ? alert.message
                  : ''
                const hasExpandableCopy = secondaryMessage.length > LONG_ALERT_THRESHOLD
                  || (!secondaryMessage && primaryText.length > LONG_ALERT_THRESHOLD)
                const isExpanded = expandedAlertIds.has(alert.id)
                return (
                  <li key={alert.id} className={`alert-row ${rowStateClass} ${alertKind?.className || ''}`}>
                    <div className="alert-row-indicator">
                      {isRecoveryPending ? (
                        <History size={14} className="alert-icon-recovered" aria-hidden="true" />
                      ) : isAcked ? (
                        <UserRoundCheck size={14} className="alert-icon-acked" aria-hidden="true" />
                      ) : (
                        <span className="alert-dot-active" aria-hidden="true" />
                      )}
                    </div>
                    <div className="alert-row-body">
                      <div className="alert-row-heading">
                        <p className={`alert-row-primary ${!secondaryMessage && hasExpandableCopy && !isExpanded ? 'is-clamped' : ''}`.trim()}>
                          {primaryText}
                        </p>
                        {alertKind ? (
                          <span className={`alert-kind-tag ${alertKind.className}`}>{alertKind.label}</span>
                        ) : null}
                      </div>
                      {secondaryMessage ? (
                        <p className={`alert-row-message ${hasExpandableCopy && !isExpanded ? 'is-clamped' : ''}`.trim()}>
                          {secondaryMessage}
                        </p>
                      ) : null}
                      {hasExpandableCopy ? (
                        <button
                          type="button"
                          className="alert-expand-btn"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedAlertIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(alert.id)) {
                              next.delete(alert.id)
                            } else {
                              next.add(alert.id)
                            }
                            return next
                          })}
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      ) : null}
                      <div className="alert-row-meta">
                        <span>{alert.machineName || 'Spiral Mill 01'}</span>
                        <span className="meta-separator">·</span>
                        <span className="alert-status-text">{statusLabel}</span>
                        {alertAcknowledgementErrors[alert.id] ? (
                          <span className="alert-acknowledgement-error" role="alert">
                            {alertAcknowledgementErrors[alert.id]}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {!isAcked ? (
                      <button
                        className="alert-acknowledge-ghost-btn"
                        type="button"
                        data-alert-ack-id={alert.id}
                        disabled={!hasTrustedAlertList || acknowledgingAlertIds.includes(alert.id)}
                        onClick={() => handleAcknowledge(alert.id)}
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <span className="alert-acked-tag">
                        <UserRoundCheck size={12} aria-hidden="true" /> Confirmed
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : hasTrustedAlertList ? (
            <div className="alerts-empty-state">
              <p>No active alerts.</p>
            </div>
          ) : null}
          <div className="alerts-popover-footer">
            {alertDestinations.length > 0 ? alertDestinations.map((destination) => (
              <NavLink
                key={destination.to}
                to={destination.to}
                className="alerts-footer-link"
                onClick={onClose}
              >
                <span>{destination.label}</span>
                <MoveRight size={14} className="alerts-footer-icon" aria-hidden="true" />
              </NavLink>
            )) : (
              <NavLink to="/dashboard/downtime" className="alerts-footer-link" onClick={onClose}>
                <span>View downtime records</span>
                <MoveRight size={14} className="alerts-footer-icon" aria-hidden="true" />
              </NavLink>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
