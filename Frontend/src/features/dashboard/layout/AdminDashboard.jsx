import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Moon, Sun } from 'lucide-react'
import Status from '../../../shared/components/Status.jsx'
import { PanelToggle } from '../../../shared/components/PanelToggle.jsx'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { useMobileViewport } from '../../../shared/hooks/useMobileViewport.js'
import { useTheme } from '../../../shared/hooks/useTheme.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
import { navItems } from '../../../shared/constants/dashboardMeta.js'
import UsersActionProvider from '../users/UsersActionProvider.jsx'
import { useLiveFeedStream } from '../live/useLiveFeedStream.js'
import { useAlertsStream } from '../alerts/useAlertsStream.js'
import AlertsPopover from '../alerts/AlertsPopover.jsx'
import DashboardSidebar from './DashboardSidebar.jsx'
import LogoutConfirmDialog from './LogoutConfirmDialog.jsx'
import './sidebar-compact.css'

function DashboardClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Align updates to minute boundaries without using backend data.
    let intervalId = null
    const msUntilNextMinute = 60000 - (Date.now() % 60000)
    const timeoutId = window.setTimeout(() => {
      setNow(new Date())
      intervalId = window.setInterval(() => {
        setNow(new Date())
      }, 60000)
    }, msUntilNextMinute)

    return () => {
      window.clearTimeout(timeoutId)
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [])

  return (
    <time className="dashboard-clock" dateTime={now.toISOString()}>
      <strong>
        {now.toLocaleTimeString('en-PH', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Manila',
        })}
      </strong>
      <span>
        {now.toLocaleDateString('en-PH', {
          month: 'short',
          day: '2-digit',
          year: 'numeric',
          timeZone: 'Asia/Manila',
        })}
      </span>
    </time>
  )
}

export default function AdminDashboard() {
  const online = useNetworkOnline()
  const isMobileViewport = useMobileViewport()
  const { token, user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isAlertsOpen, setIsAlertsOpen] = useState(false)
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)

  const topbarRef = useRef(null)
  const alertsButtonRef = useRef(null)
  const sidebarRef = useRef(null)
  const logoutButtonRef = useRef(null)
  const mobileMenuButtonRef = useRef(null)
  const liveFeedRef = useRef(null)

  const normalizedPathname = location.pathname.replace(/\/+$/, '') || '/'
  const matchedNavItem = navItems.find((item) => item.to === normalizedPathname)
  const isRouteForbidden = Boolean(matchedNavItem && !matchedNavItem.roles.includes(user?.role))

  const handleSensorStatus = useCallback((incomingLive) => {
    if (incomingLive) liveFeedRef.current?.applyEvent(incomingLive)
    else liveFeedRef.current?.reload()
  }, [])

  const handleStreamOpen = useCallback(() => {
    liveFeedRef.current?.reload()
  }, [])

  const {
    acknowledgeAlertById,
    acknowledgedAlerts,
    acknowledgingAlertIds,
    activeAlerts,
    alertAcknowledgementErrors,
    alertConnectionStatus,
    alertLoadError,
    alerts,
    cachedAlertsAt,
    hasTrustedAlertList,
    retryAlerts,
    unresolvedAlerts,
  } = useAlertsStream({
    token,
    enabled: !isRouteForbidden,
    online,
    onSensorStatus: handleSensorStatus,
    onStreamOpen: handleStreamOpen,
  })

  const liveFeed = useLiveFeedStream(isRouteForbidden ? null : token, {
    isFallbackPolling: alertConnectionStatus === 'polling',
  })

  useLayoutEffect(() => {
    liveFeedRef.current = liveFeed
  }, [liveFeed])

  const outletContext = useMemo(
    () => ({ activeAlerts, unresolvedAlerts, hasTrustedAlertList, liveFeed }),
    [activeAlerts, unresolvedAlerts, hasTrustedAlertList, liveFeed],
  )

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false)
  }, [])

  const closeAlerts = useCallback(() => {
    setIsAlertsOpen(false)
  }, [])

  const closeLogoutConfirm = useCallback(() => {
    setIsLogoutConfirmOpen(false)
  }, [])

  // Close transient overlays whenever a nested dashboard route changes.
  useEffect(() => {
    if (sidebarRef.current?.contains(document.activeElement)) {
      document.activeElement?.blur?.()
    }
    setIsDrawerOpen(false)
    setIsAlertsOpen(false)
    setIsLogoutConfirmOpen(false)
  }, [location.pathname])

  useLayoutEffect(() => {
    const headerEl = topbarRef.current
    if (!headerEl) return undefined

    function syncTopbarOffset() {
      const bottom = headerEl.getBoundingClientRect().bottom
      if (Number.isFinite(bottom) && bottom > 0) {
        headerEl.style.setProperty('--topbar-offset', `${Math.ceil(bottom + 8)}px`)
      }
    }

    syncTopbarOffset()
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(syncTopbarOffset)
      observer.observe(headerEl)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', syncTopbarOffset)
    return () => window.removeEventListener('resize', syncTopbarOffset)
  }, [isRouteForbidden])

  useEffect(() => {
    if (!isDrawerOpen && !isAlertsOpen) return undefined

    function handleEscape(event) {
      if (event.key !== 'Escape' || isLogoutConfirmOpen) return

      if (isAlertsOpen) {
        setIsAlertsOpen(false)
        alertsButtonRef.current?.focus({ preventScroll: true })
        return
      }

      if (isDrawerOpen) {
        setIsDrawerOpen(false)
        mobileMenuButtonRef.current?.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isAlertsOpen, isDrawerOpen, isLogoutConfirmOpen])

  function openLogoutConfirm() {
    setIsAlertsOpen(false)
    setIsLogoutConfirmOpen(true)
  }

  function confirmLogout() {
    logout()
    navigate('/login', { replace: true, state: { from: '/dashboard' } })
  }

  if (isRouteForbidden) {
    return (
      <main className="dashboard-shell">
        <Outlet context={outletContext} />
      </main>
    )
  }

  return (
    <div className="dashboard-shell">
      <DashboardSidebar
        user={user}
        isMobileViewport={isMobileViewport}
        isDrawerOpen={isDrawerOpen}
        isEscapeBlocked={isLogoutConfirmOpen || isAlertsOpen || isDrawerOpen}
        onCloseDrawer={closeDrawer}
        onOpenLogoutConfirm={openLogoutConfirm}
        sidebarRef={sidebarRef}
        logoutButtonRef={logoutButtonRef}
        mobileMenuButtonRef={mobileMenuButtonRef}
      />

      <div className="dashboard-main">
        <header ref={topbarRef} className={`dashboard-topbar ${normalizedPathname === '/dashboard' ? 'overview-topbar' : ''}`.trim()}>
          <div className="topbar-leading">
            <PanelToggle
              ref={mobileMenuButtonRef}
              className="mobile-only"
              isOpen={false}
              ariaLabel="Open navigation"
              onClick={() => {
                setIsAlertsOpen(false)
                setIsDrawerOpen(true)
              }}
            />
            {normalizedPathname === '/dashboard' ? <div id="overview-header-controls" /> : null}
            {normalizedPathname === '/dashboard/analytics' ? <div id="analytics-header-controls" /> : null}
            {normalizedPathname === '/dashboard/audit' ? <div id="audit-header-controls" /> : null}
            {normalizedPathname === '/dashboard/users' ? <div id="users-header-controls" /> : null}
            {normalizedPathname === '/dashboard/machines' ? <div id="machines-header-controls" /> : null}
            {normalizedPathname === '/dashboard/settings' ? <div id="settings-header-version" /> : null}
          </div>

          <div className="topbar-trailing">
            {normalizedPathname === '/dashboard/settings' ? <div id="settings-header-controls" /> : null}
            {cachedAlertsAt && !hasTrustedAlertList ? <Status tone="danger">Cached alerts stale</Status> : null}
            <Status
              value={online && alertConnectionStatus === 'live' ? 'active' : ''}
              tone={!online || alertConnectionStatus === 'degraded' ? 'danger' : alertConnectionStatus === 'polling' || alertConnectionStatus === 'reconnecting' ? 'fault' : undefined}
              role="status"
            >
              {!online ? 'Offline' : alertConnectionStatus === 'live'
                ? 'Live'
                : alertConnectionStatus === 'polling'
                  ? 'Polling'
                  : alertConnectionStatus === 'connecting'
                    ? 'Connecting'
                    : alertConnectionStatus === 'degraded'
                      ? 'Real-time temporarily unavailable — retrying'
                      : 'Reconnecting'}
            </Status>
            <div className="topbar-divider" aria-hidden="true" />
            <DashboardClock />
            <div className="topbar-divider" aria-hidden="true" />
            <button
              className={`theme-toggle-btn is-${theme}`}
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? (
                <Sun className="theme-toggle-icon is-sun" size={18} aria-hidden="true" />
              ) : (
                <Moon className="theme-toggle-icon is-moon" size={18} aria-hidden="true" />
              )}
            </button>
            <div className="topbar-divider" aria-hidden="true" />
            <AlertsPopover
              isOpen={isAlertsOpen}
              onToggle={() => {
                setIsDrawerOpen(false)
                setIsAlertsOpen((value) => !value)
              }}
              onClose={closeAlerts}
              buttonRef={alertsButtonRef}
              alerts={alerts}
              activeAlerts={activeAlerts}
              acknowledgedAlerts={acknowledgedAlerts}
              unresolvedAlerts={unresolvedAlerts}
              hasTrustedAlertList={hasTrustedAlertList}
              cachedAlertsAt={cachedAlertsAt}
              alertLoadError={alertLoadError}
              acknowledgingAlertIds={acknowledgingAlertIds}
              alertAcknowledgementErrors={alertAcknowledgementErrors}
              onRetryAlerts={retryAlerts}
              onAcknowledgeAlert={acknowledgeAlertById}
            />
          </div>
        </header>

        <main className={`dashboard-content ${normalizedPathname === '/dashboard' ? 'overview-content' : ''}`}>
          {/* Nested /dashboard routes render here. */}
          <UsersActionProvider>
            <Outlet context={outletContext} />
          </UsersActionProvider>
        </main>
      </div>

      <LogoutConfirmDialog
        isOpen={isLogoutConfirmOpen}
        onClose={closeLogoutConfirm}
        onConfirm={confirmLogout}
        triggerButtonRef={logoutButtonRef}
      />
    </div>
  )
}
