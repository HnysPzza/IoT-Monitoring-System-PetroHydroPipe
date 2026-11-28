import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import {
  BarChart3,
  LogOut,
  Logs,
  Monitor,
  Rss,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react'
import { getRoleDisplayName } from '../../../shared/constants/roleLabels.js'
import { getNavItemLabel, navGroups, navItems } from '../../../shared/constants/dashboardMeta.js'
import { PanelToggle } from '../../../shared/components/PanelToggle.jsx'
import { AnimatedGauge } from '../../../shared/components/AnimatedGauge.jsx'
import { AnimatedAnalytics } from '../../../shared/components/AnimatedAnalytics.jsx'
import { NotebookDot } from '../../../shared/components/NotebookDot.jsx'

const SIDEBAR_SCROLL_ACTIVE_MS = 500

const icons = {
  gauge: AnimatedGauge,
  rss: Rss,
  'triangle-alert': TriangleAlert,
  'bar-chart-3': BarChart3,
  'chart-no-axes-combined': AnimatedAnalytics,
  users: Users,
  monitor: Monitor,
  logs: Logs,
  'notebook-dot': NotebookDot,
  settings: Settings,
}

export default function DashboardSidebar({
  user,
  isMobileViewport,
  isDrawerOpen,
  isEscapeBlocked,
  onCloseDrawer,
  onOpenLogoutConfirm,
  sidebarRef,
  logoutButtonRef,
  mobileMenuButtonRef,
}) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isSidebarScrolling, setIsSidebarScrolling] = useState(false)
  const [hoveredTooltip, setHoveredTooltip] = useState(null)
  const [focusedTooltip, setFocusedTooltip] = useState(null)

  const pointerFocusedToRef = useRef(null)
  const desktopSidebarToggleRef = useRef(null)
  const mobileCloseButtonRef = useRef(null)
  const sidebarScrollTimerRef = useRef(null)

  const collapsedTooltip = hoveredTooltip || focusedTooltip
  const isDesktopSidebarCollapsed = !isMobileViewport && isSidebarCollapsed

  const visibleNavGroups = useMemo(
    () => navGroups
      .map((group) => ({
        ...group,
        items: navItems.filter((item) => item.group === group.id && item.roles.includes(user?.role)),
      }))
      .filter((group) => group.items.length > 0),
    [user?.role],
  )

  useEffect(() => {
    if (!isDesktopSidebarCollapsed) {
      setHoveredTooltip(null)
      setFocusedTooltip(null)
      pointerFocusedToRef.current = null
    }
  }, [isDesktopSidebarCollapsed])

  useEffect(() => {
    if (!isMobileViewport || isDrawerOpen) return
    if (sidebarRef.current?.contains(document.activeElement)) {
      mobileMenuButtonRef.current?.focus({ preventScroll: true })
    }
  }, [isDrawerOpen, isMobileViewport, sidebarRef, mobileMenuButtonRef])

  useEffect(() => {
    if (isMobileViewport || !isDrawerOpen) return

    onCloseDrawer()
    desktopSidebarToggleRef.current?.focus({ preventScroll: true })
  }, [isDrawerOpen, isMobileViewport, onCloseDrawer])

  useEffect(() => {
    if (!isMobileViewport || !isDrawerOpen) return

    mobileCloseButtonRef.current?.focus({ preventScroll: true })
  }, [isDrawerOpen, isMobileViewport])

  useEffect(() => {
    if (!collapsedTooltip || isEscapeBlocked) return undefined

    function handleEscape(event) {
      if (event.key !== 'Escape') return
      setHoveredTooltip(null)
      setFocusedTooltip(null)
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [collapsedTooltip, isEscapeBlocked])

  useEffect(() => () => {
    if (sidebarScrollTimerRef.current !== null) {
      window.clearTimeout(sidebarScrollTimerRef.current)
      sidebarScrollTimerRef.current = null
    }
  }, [])

  function clearTooltips() {
    setHoveredTooltip(null)
    setFocusedTooltip(null)
    pointerFocusedToRef.current = null
  }

  function handleSidebarScroll() {
    setIsSidebarScrolling(true)
    clearTooltips()

    if (sidebarScrollTimerRef.current !== null) {
      window.clearTimeout(sidebarScrollTimerRef.current)
    }

    sidebarScrollTimerRef.current = window.setTimeout(() => {
      sidebarScrollTimerRef.current = null
      setIsSidebarScrolling(false)
    }, SIDEBAR_SCROLL_ACTIVE_MS)
  }

  return (
    <>
      <aside
        ref={sidebarRef}
        className={`dashboard-sidebar ${isDesktopSidebarCollapsed ? 'is-collapsed' : ''} ${isDrawerOpen ? 'is-open' : ''}`}
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
          <PanelToggle
            ref={desktopSidebarToggleRef}
            className="sidebar-toggle desktop-only"
            size={16}
            isCollapsed={isDesktopSidebarCollapsed}
            ariaLabel={isDesktopSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setIsSidebarCollapsed((value) => !value)}
          />
          <PanelToggle
            ref={mobileCloseButtonRef}
            className="sidebar-toggle mobile-only"
            isOpen={true}
            ariaLabel="Close navigation"
            onClick={() => {
              onCloseDrawer()
              mobileMenuButtonRef.current?.focus({ preventScroll: true })
            }}
          />
        </div>

        <nav
          className={`sidebar-nav ${isSidebarScrolling ? 'is-scrolling' : ''}`}
          aria-label="Dashboard sections"
          onScroll={handleSidebarScroll}
        >
          {visibleNavGroups.map((group) => (
            <div className="sidebar-nav-group" key={group.id}>
              <p className="sidebar-nav-heading">{group.label}</p>
              <div className="sidebar-nav-links">
                {group.items.map((item) => {
                  const Icon = icons[item.icon]
                  const itemLabel = getNavItemLabel(item, user?.role)
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/dashboard'}
                      title={isDesktopSidebarCollapsed ? itemLabel : undefined}
                      data-label={itemLabel}
                      aria-label={isDesktopSidebarCollapsed ? itemLabel : undefined}
                      aria-describedby={isDesktopSidebarCollapsed && collapsedTooltip?.to === item.to ? 'sidebar-collapsed-tooltip' : undefined}
                      onPointerDown={() => {
                        pointerFocusedToRef.current = item.to
                        setFocusedTooltip((current) => (current?.to === item.to ? null : current))
                      }}
                      onMouseEnter={(event) => {
                        if (!isDesktopSidebarCollapsed) return
                        const rect = event.currentTarget.getBoundingClientRect()
                        setHoveredTooltip({ to: item.to, label: itemLabel, top: rect.top + rect.height / 2 })
                      }}
                      onMouseLeave={() => {
                        if (pointerFocusedToRef.current === item.to) {
                          pointerFocusedToRef.current = null
                        }
                        setHoveredTooltip((current) => (current?.to === item.to ? null : current))
                      }}
                      onFocus={(event) => {
                        const isPointerFocus = pointerFocusedToRef.current === item.to
                        pointerFocusedToRef.current = null
                        if (!isDesktopSidebarCollapsed || isPointerFocus) return
                        const rect = event.currentTarget.getBoundingClientRect()
                        setFocusedTooltip({ to: item.to, label: itemLabel, top: rect.top + rect.height / 2 })
                      }}
                      onBlur={() => {
                        pointerFocusedToRef.current = null
                        setFocusedTooltip((current) => (current?.to === item.to ? null : current))
                      }}
                      onClick={(event) => {
                        if (isMobileViewport) event.currentTarget.blur()
                      }}
                      className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''} is-${item.icon}`}
                    >
                      <Icon
                        className="sidebar-link-icon"
                        size={16}
                        strokeWidth={item.icon === 'logs' ? 2.25 : 1.75}
                        aria-hidden="true"
                      />
                      <span className="sidebar-link-copy">
                        <span className="sidebar-link-label">{itemLabel}</span>
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
              <UserRound size={16} strokeWidth={1.85} />
            </span>
            <div className="sidebar-user-copy">
              <span className="sidebar-user-name">{user?.name || 'Administrator'}</span>
              <span className="sidebar-user-role">{getRoleDisplayName(user?.role || 'Admin')}</span>
            </div>
            <button
              ref={logoutButtonRef}
              className="sidebar-logout"
              type="button"
              aria-label="Logout"
              title={isDesktopSidebarCollapsed ? undefined : 'Log out'}
              aria-describedby={isDesktopSidebarCollapsed && collapsedTooltip?.to === '__logout__' ? 'sidebar-collapsed-tooltip' : undefined}
              onPointerDown={() => {
                pointerFocusedToRef.current = '__logout__'
                setFocusedTooltip((current) => (current?.to === '__logout__' ? null : current))
              }}
              onMouseEnter={(event) => {
                if (!isDesktopSidebarCollapsed) return
                const rect = event.currentTarget.getBoundingClientRect()
                setHoveredTooltip({ to: '__logout__', label: 'Log out', top: rect.top + rect.height / 2 })
              }}
              onMouseLeave={() => {
                if (pointerFocusedToRef.current === '__logout__') {
                  pointerFocusedToRef.current = null
                }
                setHoveredTooltip((current) => (current?.to === '__logout__' ? null : current))
              }}
              onFocus={(event) => {
                const isPointerFocus = pointerFocusedToRef.current === '__logout__'
                pointerFocusedToRef.current = null
                if (!isDesktopSidebarCollapsed || isPointerFocus) return
                const rect = event.currentTarget.getBoundingClientRect()
                setFocusedTooltip({ to: '__logout__', label: 'Log out', top: rect.top + rect.height / 2 })
              }}
              onBlur={() => {
                pointerFocusedToRef.current = null
                setFocusedTooltip((current) => (current?.to === '__logout__' ? null : current))
              }}
              onClick={() => {
                clearTooltips()
                onOpenLogoutConfirm()
              }}
            >
              <LogOut className="sidebar-logout-icon" size={16} strokeWidth={1.85} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {isDesktopSidebarCollapsed && collapsedTooltip ? (
        <div
          id="sidebar-collapsed-tooltip"
          className="sidebar-collapsed-tooltip"
          role="tooltip"
          style={{ top: `${collapsedTooltip.top}px` }}
        >
          {collapsedTooltip.label}
        </div>
      ) : null}

      <button
        className={`sidebar-backdrop mobile-only ${isDrawerOpen ? 'is-open' : ''}`}
        type="button"
        aria-label="Close navigation overlay"
        aria-hidden={!isDrawerOpen || undefined}
        tabIndex={isDrawerOpen ? 0 : -1}
        disabled={!isDrawerOpen}
        onClick={() => {
          onCloseDrawer()
          mobileMenuButtonRef.current?.focus({ preventScroll: true })
        }}
      />
    </>
  )
}
