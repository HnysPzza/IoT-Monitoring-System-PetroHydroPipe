import { Activity, BarChart3, Bell, Gauge, History, Menu, Monitor, Settings, TriangleAlert, UserRound, Users, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { dashboardPageMeta, navItems } from '../../../shared/constants/dashboardMeta.js'
import { getDashboardOverview } from '../overview/dashboardService.js'

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
    <p className="dashboard-clock" aria-live="off">
      {now.toLocaleTimeString('en-PH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}{' - '}
      {now.toLocaleDateString('en-PH', {
        weekday: 'long',
        month: 'long',
        day: '2-digit',
        year: 'numeric',
      })}
    </p>
  )
}

export default function AdminDashboard() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [alerts, setAlerts] = useState([])
  const [isAlertsOpen, setIsAlertsOpen] = useState(false)
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Sidebar items are filtered by the role stored in the auth token response.
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => item.roles.includes(user?.role)),
    [user?.role],
  )

  const pageMeta = dashboardPageMeta[location.pathname] || dashboardPageMeta['/dashboard']
  const activeAlertCount = alerts.length

  // Close the mobile drawer whenever a nested dashboard route changes.
  useEffect(() => {
    setIsDrawerOpen(false)
    setIsAlertsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    let isMounted = true

    async function loadAlertState() {
      if (!token) return

      try {
        const payload = await getDashboardOverview(token)
        if (isMounted) {
          setAlerts(payload.alerts || [])
        }
      } catch {
        if (isMounted) {
          setAlerts([])
        }
      }
    }

    loadAlertState()
    const refreshId = window.setInterval(loadAlertState, 60000)

    return () => {
      isMounted = false
      window.clearInterval(refreshId)
    }
  }, [token])

  function handleLogout() {
    // Clears local auth, then returns the user to the login page.
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <main className="dashboard-shell">
      <aside className={`dashboard-sidebar ${isSidebarCollapsed ? 'is-collapsed' : ''} ${isDrawerOpen ? 'is-open' : ''}`}>
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
            className="icon-button dashboard-icon-button mobile-only"
            type="button"
            aria-label="Close navigation"
            onClick={() => setIsDrawerOpen(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard sections">
          {visibleNavItems.map((item) => {
            const Icon = icons[item.icon]
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/dashboard'}
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
          <button className="btn btn-secondary sidebar-logout" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>

      {isDrawerOpen ? <button className="sidebar-backdrop mobile-only" type="button" aria-label="Close navigation overlay" onClick={() => setIsDrawerOpen(false)} /> : null}

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="topbar-leading">
            <button
              className="icon-button dashboard-icon-button mobile-only"
              type="button"
              aria-label="Open navigation"
              onClick={() => setIsDrawerOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <div>
              <p className="topbar-label">{pageMeta.title}</p>
              <p className="topbar-subtitle">{pageMeta.subtitle}</p>
            </div>
          </div>

          <div className="topbar-trailing">
            <DashboardClock />
            <button
              className={`icon-button dashboard-icon-button notification-button ${activeAlertCount > 0 ? 'is-alerting' : ''}`}
              type="button"
              aria-label={activeAlertCount > 0 ? `Open alerts, ${activeAlertCount} active` : 'Open alerts, none active'}
              aria-expanded={isAlertsOpen}
              onClick={() => setIsAlertsOpen((value) => !value)}
            >
              <Bell size={18} aria-hidden="true" />
              {activeAlertCount > 0 ? <span className="notification-badge" aria-hidden="true">{activeAlertCount}</span> : null}
            </button>
            {isAlertsOpen ? (
              <div className="alerts-popover" role="dialog" aria-label="Active alerts">
                <div className="alerts-popover-header">
                  <strong>Active alerts</strong>
                  <span>{activeAlertCount}</span>
                </div>
                {activeAlertCount > 0 ? (
                  <ul>
                    {alerts.map((alert) => (
                      <li key={alert.id}>
                        <TriangleAlert size={15} aria-hidden="true" />
                        <span>{alert.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No active alerts.</p>
                )}
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
