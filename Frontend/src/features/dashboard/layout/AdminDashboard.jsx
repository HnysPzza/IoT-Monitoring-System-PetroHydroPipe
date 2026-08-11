import { Activity, BarChart3, Bell, Check, Gauge, History, LogOut, Menu, Monitor, Settings, TriangleAlert, UserRound, Users, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { dashboardPageMeta, navGroups, navItems } from '../../../shared/constants/dashboardMeta.js'
import {
  applyLiveAlertDelta,
  areAlertDeltasEquivalent,
  isAlertEventCompatible,
  parseAlertRevision,
  reconcileAlertSnapshot,
} from '../alerts/alertReconciliation.js'
import { acknowledgeAlert, getAlerts, subscribeToAlerts } from '../alerts/alertsService.js'

const ALERT_RESYNC_MIN_INTERVAL_MS = 5000
const MAX_BUFFERED_ALERT_DELTAS = 256
const ALERT_STREAM_EVENT_TYPES = new Set([
  'alert.acknowledged',
  'alert.created',
  'alert.resolved',
  'alert.updated',
])
const ACKNOWLEDGEMENT_RESPONSE_STATUSES = new Set(['Acknowledged', 'Resolved'])

const icons = {
  gauge: Gauge,
  activity: Activity,
  'triangle-alert': TriangleAlert,
  'bar-chart-3': BarChart3,
  users: Users,
  monitor: Monitor,
  history: History,
  settings: Settings,
}

function DashboardClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Local clock updates the topbar without using backend data.
    const timerId = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  return (
    <time className="dashboard-clock" dateTime={now.toISOString()}>
      <strong>
        {now.toLocaleTimeString('en-PH', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </strong>
      <span>
        {now.toLocaleDateString('en-PH', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
        })}
      </span>
    </time>
  )
}

function getAlertStatusLabel(alert) {
  if (alert.status === 'Active' && alert.metadata?.recoveryPending) {
    return 'Recovered, waiting for acknowledgement'
  }

  return alert.status
}

function matchesMobileDashboard() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches
}

export default function AdminDashboard() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [alerts, setAlerts] = useState([])
  const [acknowledgingAlertIds, setAcknowledgingAlertIds] = useState([])
  const [alertLoadError, setAlertLoadError] = useState('')
  const [alertAcknowledgementErrors, setAlertAcknowledgementErrors] = useState({})
  const [hasTrustedAlertList, setHasTrustedAlertList] = useState(false)
  const [alertConnectionStatus, setAlertConnectionStatus] = useState('connecting')
  const [isAlertsOpen, setIsAlertsOpen] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(matchesMobileDashboard)
  const alertsButtonRef = useRef(null)
  const alertsPopoverRef = useRef(null)
  const mobileMenuButtonRef = useRef(null)
  const mobileCloseButtonRef = useRef(null)
  const retryAlertsRef = useRef(() => {})
  const sessionTokenRef = useRef(null)
  const acknowledgementIdRef = useRef(0)
  const acknowledgementOperationsRef = useRef(new Map())
  const applyAlertDeltaRef = useRef(() => {})
  const { token, user, logout } = useAuth()
  sessionTokenRef.current = token
  const navigate = useNavigate()
  const location = useLocation()

  // Sidebar items are filtered by the role stored in the auth token response.
  const visibleNavGroups = useMemo(
    () => navGroups
      .map((group) => ({
        ...group,
        items: navItems.filter((item) => item.group === group.id && item.roles.includes(user?.role)),
      }))
      .filter((group) => group.items.length > 0),
    [user?.role],
  )

  const pageMeta = dashboardPageMeta[location.pathname] || dashboardPageMeta['/dashboard']
  const activeAlerts = alerts.filter((alert) => alert.status === 'Active')
  const acknowledgedAlerts = alerts.filter((alert) => alert.status === 'Acknowledged')
  const activeAlertCount = activeAlerts.length

  // Close the mobile drawer whenever a nested dashboard route changes.
  useEffect(() => {
    setIsDrawerOpen(false)
    setIsAlertsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined

    const mediaQuery = window.matchMedia('(max-width: 900px)')
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches)

    updateViewport()
    mediaQuery.addEventListener('change', updateViewport)

    return () => {
      mediaQuery.removeEventListener('change', updateViewport)
    }
  }, [])

  useEffect(() => {
    if (!isDrawerOpen) return

    mobileCloseButtonRef.current?.focus({ preventScroll: true })
  }, [isDrawerOpen])

  useEffect(() => {
    if (!isAlertsOpen) return

    alertsPopoverRef.current?.focus({ preventScroll: true })

    function handlePointerDown(event) {
      if (alertsPopoverRef.current?.contains(event.target) || alertsButtonRef.current?.contains(event.target)) {
        return
      }

      setIsAlertsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isAlertsOpen])

  useEffect(() => {
    if (!isDrawerOpen && !isAlertsOpen) return undefined

    function handleEscape(event) {
      if (event.key !== 'Escape') return

      if (isAlertsOpen) {
        setIsAlertsOpen(false)
        alertsButtonRef.current?.focus({ preventScroll: true })
        return
      }

      setIsDrawerOpen(false)
      mobileMenuButtonRef.current?.focus({ preventScroll: true })
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isAlertsOpen, isDrawerOpen])

  useEffect(() => {
    if (!token) return undefined

    let isMounted = true
    let pollingId = null
    let resyncTimerId = null
    let activeListRequest = null
    let reloadQueued = false
    let lastReloadStartedAt = null
    let currentAlerts = []
    let currentRevision = 0n
    let hasTrustedSnapshot = false

    setAlerts([])
    setAcknowledgingAlertIds([])
    setAlertAcknowledgementErrors({})
    setAlertLoadError('')
    setHasTrustedAlertList(false)
    setAlertConnectionStatus('connecting')
    acknowledgementOperationsRef.current = new Map()

    function replaceAlertState(nextAlerts, nextRevision) {
      currentAlerts = nextAlerts
      currentRevision = nextRevision
      setAlerts(nextAlerts)
    }

    function scheduleAlertReload() {
      if (!isMounted) return

      if (activeListRequest) {
        reloadQueued = true
        return
      }

      const elapsed = lastReloadStartedAt === null
        ? ALERT_RESYNC_MIN_INTERVAL_MS
        : Date.now() - lastReloadStartedAt
      const delay = Math.max(0, ALERT_RESYNC_MIN_INTERVAL_MS - elapsed)

      if (delay > 0) {
        reloadQueued = true
        if (!resyncTimerId) {
          resyncTimerId = window.setTimeout(() => {
            resyncTimerId = null
            if (!isMounted || !reloadQueued) return
            reloadQueued = false
            void loadAlertState()
          }, delay)
        }
        return
      }

      reloadQueued = false
      void loadAlertState()
    }

    async function loadAlertState() {
      if (!isMounted || !token) return

      if (activeListRequest) {
        reloadQueued = true
        return
      }

      const listRequest = {
        bufferedByRevision: new Map(),
        hasUntrustedBuffer: false,
      }
      activeListRequest = listRequest
      lastReloadStartedAt = Date.now()

      try {
        const payload = await getAlerts(token)
        if (isMounted && activeListRequest === listRequest) {
          const reconciliation = reconcileAlertSnapshot(
            payload,
            [...listRequest.bufferedByRevision.values()],
          )

          if (!reconciliation.trusted) {
            reloadQueued = true
            setAlertLoadError('Alert state could not be verified. Retrying...')
          } else if (reconciliation.revision < currentRevision) {
            reloadQueued = true
            if (!hasTrustedSnapshot) {
              setAlertLoadError('Alert state could not be verified. Retrying...')
            }
          } else {
            replaceAlertState(reconciliation.alerts, reconciliation.revision)
            if (reconciliation.needsResync || listRequest.hasUntrustedBuffer) {
              reloadQueued = true
            }
            hasTrustedSnapshot = true
            setHasTrustedAlertList(true)
            setAlertLoadError('')
          }
        }
      } catch (error) {
        if (isMounted && activeListRequest === listRequest) {
          setAlertLoadError(error.message || 'Unable to load alerts. Please try again.')
        }
      } finally {
        if (activeListRequest === listRequest) {
          activeListRequest = null
          if (reloadQueued) scheduleAlertReload()
        }
      }
    }

    function bufferAlertDelta(alert) {
      if (!activeListRequest) return

      const revision = parseAlertRevision(alert?.revision)
      if (revision === null) {
        activeListRequest.hasUntrustedBuffer = true
        return
      }

      const existing = activeListRequest.bufferedByRevision.get(alert.revision)
      if (existing) {
        if (!areAlertDeltasEquivalent(existing, alert)) {
          activeListRequest.hasUntrustedBuffer = true
        }
        return
      }

      if (activeListRequest.bufferedByRevision.size >= MAX_BUFFERED_ALERT_DELTAS) {
        activeListRequest.hasUntrustedBuffer = true
        return
      }

      activeListRequest.bufferedByRevision.set(alert.revision, alert)
    }

    function applyAlertDelta(alert, { fromAcknowledgement = false } = {}) {
      if (!isMounted) return

      if (!alert) {
        if (fromAcknowledgement) scheduleAlertReload()
        return
      }

      const isBufferedByActiveRequest = Boolean(activeListRequest)

      if (fromAcknowledgement && !ACKNOWLEDGEMENT_RESPONSE_STATUSES.has(alert.status)) {
        if (activeListRequest) {
          activeListRequest.hasUntrustedBuffer = true
        } else {
          scheduleAlertReload()
        }
        return
      }

      bufferAlertDelta(alert)
      const result = applyLiveAlertDelta(currentAlerts, currentRevision, alert)

      if (result.applied) {
        replaceAlertState(result.alerts, result.revision)
      }

      if (result.needsResync && !isBufferedByActiveRequest) scheduleAlertReload()
    }

    function startFallbackPolling() {
      if (!isMounted || pollingId) return

      setAlertConnectionStatus('polling')
      pollingId = window.setInterval(scheduleAlertReload, 10000)
    }

    function stopFallbackPolling() {
      if (!isMounted) return
      if (pollingId) {
        window.clearInterval(pollingId)
        pollingId = null
      }
      setAlertConnectionStatus('live')
    }

    retryAlertsRef.current = scheduleAlertReload
    applyAlertDeltaRef.current = applyAlertDelta
    void loadAlertState()
    const unsubscribe = subscribeToAlerts(token, {
      onEvent: (event) => {
        if (!isMounted || typeof event?.type !== 'string' || !event.type.startsWith('alert.')) return

        if (
          !ALERT_STREAM_EVENT_TYPES.has(event.type)
          || !event.payload?.alert
          || !isAlertEventCompatible(event.type, event.payload.alert)
        ) {
          scheduleAlertReload()
          return
        }

        applyAlertDeltaRef.current(event.payload.alert)
      },
      onFallback: startFallbackPolling,
      onOpen: () => {
        if (isMounted) scheduleAlertReload()
      },
      onRecovery: stopFallbackPolling,
      onStatusChange: (status) => {
        if (!isMounted) return
        if (status === 'live') setAlertConnectionStatus('live')
        if (status === 'connecting') setAlertConnectionStatus('connecting')
        if (status === 'reconnecting') setAlertConnectionStatus('reconnecting')
      },
    })

    return () => {
      isMounted = false
      activeListRequest = null
      reloadQueued = false
      retryAlertsRef.current = () => {}
      applyAlertDeltaRef.current = () => {}
      unsubscribe()

      if (pollingId) {
        window.clearInterval(pollingId)
      }

      if (resyncTimerId) {
        window.clearTimeout(resyncTimerId)
      }
    }
  }, [token])

  async function handleAcknowledgeAlert(alertId) {
    if (!token || acknowledgementOperationsRef.current.has(alertId)) return

    const operationId = acknowledgementIdRef.current + 1
    acknowledgementIdRef.current = operationId
    acknowledgementOperationsRef.current.set(alertId, operationId)
    setAcknowledgingAlertIds((currentIds) => [...currentIds, alertId])
    setAlertAcknowledgementErrors((current) => ({ ...current, [alertId]: '' }))

    try {
      const payload = await acknowledgeAlert(token, alertId)
      if (sessionTokenRef.current !== token || acknowledgementOperationsRef.current.get(alertId) !== operationId) return
      applyAlertDeltaRef.current(payload.alert, { fromAcknowledgement: true })
    } catch (error) {
      if (sessionTokenRef.current === token && acknowledgementOperationsRef.current.get(alertId) === operationId) {
        setAlertAcknowledgementErrors((current) => ({
          ...current,
          [alertId]: error.message || 'Unable to acknowledge alert.',
        }))
      }
    } finally {
      if (acknowledgementOperationsRef.current.get(alertId) === operationId) {
        acknowledgementOperationsRef.current.delete(alertId)
        setAcknowledgingAlertIds((currentIds) => currentIds.filter((id) => id !== alertId))
      }
    }
  }

  function handleLogout() {
    // Clears local auth, then returns the user to the login page.
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <main className="dashboard-shell">
      <aside
        className={`dashboard-sidebar ${isSidebarCollapsed ? 'is-collapsed' : ''} ${isDrawerOpen ? 'is-open' : ''}`}
        aria-hidden={isMobileViewport && !isDrawerOpen ? 'true' : undefined}
        inert={isMobileViewport && !isDrawerOpen}
      >
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img className="sidebar-logo" src="/assets/logo.png" alt="PetroHydroPipe logo" />
            <div className="sidebar-brand-copy">
              <span className="sidebar-brand-name">PetroHydroPipe</span>
            </div>
          </div>
          <button
            className="icon-button dashboard-icon-button desktop-only"
            type="button"
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setIsSidebarCollapsed((value) => !value)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <button
            ref={mobileCloseButtonRef}
            className="icon-button dashboard-icon-button mobile-only"
            type="button"
            aria-label="Close navigation"
            onClick={() => {
              setIsDrawerOpen(false)
              mobileMenuButtonRef.current?.focus({ preventScroll: true })
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard sections">
          {visibleNavGroups.map((group) => (
            <div className="sidebar-nav-group" key={group.id}>
              <p className="sidebar-nav-heading">{group.label}</p>
              <div className="sidebar-nav-links">
                {group.items.map((item) => {
                  const Icon = icons[item.icon]
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/dashboard'}
                      title={isSidebarCollapsed ? item.label : undefined}
                      className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`}
                    >
                      <span className="sidebar-link-icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span className="sidebar-link-copy">
                        <span className="sidebar-link-label">{item.label}</span>
                      </span>
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-avatar" aria-hidden="true">
              <UserRound size={18} />
            </span>
            <div className="sidebar-user-copy">
              <span className="sidebar-user-name">{user?.name || 'Administrator'}</span>
              <span className="sidebar-user-role">{user?.role || 'Admin'}</span>
            </div>
          </div>
          <button className="btn btn-secondary sidebar-logout" type="button" aria-label="Logout" onClick={handleLogout}>
            <LogOut size={18} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {isDrawerOpen ? (
        <button
          className="sidebar-backdrop mobile-only"
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => {
            setIsDrawerOpen(false)
            mobileMenuButtonRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : null}

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="topbar-leading">
            <button
              ref={mobileMenuButtonRef}
              className="icon-button dashboard-icon-button mobile-only"
              type="button"
              aria-label="Open navigation"
              onClick={() => {
                setIsAlertsOpen(false)
                setIsDrawerOpen(true)
              }}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <div>
              <h1 className="topbar-label">{pageMeta.title}</h1>
              <p className="topbar-subtitle">{pageMeta.subtitle}</p>
            </div>
          </div>

          <div className="topbar-trailing">
            <span className={`alert-connection-status is-${alertConnectionStatus}`} role="status">
              {alertConnectionStatus === 'live'
                ? 'Live'
                : alertConnectionStatus === 'polling'
                  ? 'Polling'
                  : alertConnectionStatus === 'connecting'
                    ? 'Connecting'
                    : 'Reconnecting'}
            </span>
            <DashboardClock />
            <button
              ref={alertsButtonRef}
              className={`icon-button dashboard-icon-button notification-button ${activeAlertCount > 0 ? 'is-alerting' : ''}`}
              type="button"
              aria-label={
                !hasTrustedAlertList
                  ? 'Open alerts, status unavailable'
                  : activeAlertCount > 0
                    ? `Open alerts, ${activeAlertCount} active`
                    : 'Open alerts, none active'
              }
              aria-expanded={isAlertsOpen}
              onClick={() => {
                setIsDrawerOpen(false)
                setIsAlertsOpen((value) => !value)
              }}
            >
              <Bell size={18} aria-hidden="true" />
              <span className="sr-only">
                {!hasTrustedAlertList
                  ? 'Alert status unavailable'
                  : activeAlertCount > 0
                    ? `${activeAlertCount} active alerts`
                    : 'No active alerts'}
              </span>
            </button>
            {isAlertsOpen ? (
              <div ref={alertsPopoverRef} className="alerts-popover" role="dialog" aria-label="Active alerts" tabIndex="-1">
                <div className="alerts-popover-header">
                  <strong>Notifications</strong>
                  <span aria-label={!hasTrustedAlertList ? 'Alert count unavailable' : undefined}>
                    {hasTrustedAlertList ? activeAlertCount : '—'}
                  </span>
                </div>
                {alertLoadError ? (
                  <div className="alert-load-error" role="alert">
                    <span>{alertLoadError}</span>
                    <button className="btn btn-secondary" type="button" onClick={() => retryAlertsRef.current()}>
                      Retry
                    </button>
                  </div>
                ) : null}
                {alerts.length > 0 ? (
                  <ul>
                    {[...activeAlerts, ...acknowledgedAlerts].map((alert) => (
                      <li key={alert.id} className={alert.status === 'Acknowledged' ? 'is-acknowledged' : ''}>
                        <TriangleAlert size={15} aria-hidden="true" />
                        <div className="alert-popover-copy">
                          <span className="alert-popover-title">{alert.title}</span>
                          <span>{alert.message}</span>
                          <span className="alert-popover-meta">{getAlertStatusLabel(alert)}</span>
                          {alertAcknowledgementErrors[alert.id] ? (
                            <span className="alert-acknowledgement-error" role="alert">
                              {alertAcknowledgementErrors[alert.id]}
                            </span>
                          ) : null}
                        </div>
                        {alert.status === 'Active' ? (
                          <button
                            className="btn btn-secondary alert-acknowledge-button"
                            type="button"
                            disabled={acknowledgingAlertIds.includes(alert.id)}
                            onClick={() => handleAcknowledgeAlert(alert.id)}
                          >
                            <Check size={14} aria-hidden="true" />
                            Acknowledge
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : hasTrustedAlertList ? (
                  <p>No active alerts.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <section className="dashboard-content">
          {/* Nested /dashboard routes render here. */}
          <Outlet />
        </section>
      </div>
    </main>
  )
}
