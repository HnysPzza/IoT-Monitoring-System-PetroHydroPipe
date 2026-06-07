import { Activity, BarChart3, Bell, Gauge, History, Menu, Monitor, Settings, TriangleAlert, UserRound, Users, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../shared/session/AuthContext.jsx'
import { dashboardPageMeta, navItems, overviewMockData } from '../../../shared/data/dashboardMock.js'

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
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const visibleNavItems = useMemo(
    () => navItems.filter((item) => item.roles.includes(user?.role)),
    [user?.role],
  )

  const pageMeta = dashboardPageMeta[location.pathname] || dashboardPageMeta['/dashboard']

  useEffect(() => {
    setIsDrawerOpen(false)
  }, [location.pathname])

  function handleLogout() {
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
            <button className="icon-button dashboard-icon-button notification-button" type="button" aria-label={`Unread alerts: ${overviewMockData.unreadAlerts}`}>
              <Bell size={18} aria-hidden="true" />
              {overviewMockData.unreadAlerts > 0 ? <span className="notification-dot" aria-hidden="true" /> : null}
            </button>
          </div>
        </header>

        <section className="dashboard-content">
          <Outlet />
        </section>
      </div>
    </main>
  )
}
