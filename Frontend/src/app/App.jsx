import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from '../shared/hooks/useAuth.js'
import RequireRole from '../shared/components/RequireRole.jsx'
import DashboardErrorBoundary from '../shared/errors/DashboardErrorBoundary.jsx'
import LoginPage from '../features/auth/LoginPage.jsx'
import { getCurrentDashboardPath } from '../features/auth/authNavigation.js'

const AdminDashboard = lazy(() => import('../features/dashboard/layout/AdminDashboard.jsx'))
const AnalyticsSection = lazy(() => import('../features/dashboard/analytics/AnalyticsSection.jsx'))
const AuditSection = lazy(() => import('../features/dashboard/audit/AuditSection.jsx'))
const DashboardSection = lazy(() => import('../features/dashboard/overview/DashboardSection.jsx'))
const DowntimeSection = lazy(() => import('../features/dashboard/downtime/DowntimeSection.jsx'))
const LiveSection = lazy(() => import('../features/dashboard/live/LiveSection.jsx'))
const MachinesSection = lazy(() => import('../features/dashboard/machines/MachinesSection.jsx'))
const ReportsSection = lazy(() => import('../features/dashboard/reports/ReportsSection.jsx'))
const SettingsSection = lazy(() => import('../features/dashboard/settings/SettingsSection.jsx'))
const UsersSection = lazy(() => import('../features/dashboard/users/UsersSection.jsx'))

export function ProtectedRoute({ children }) {
  const { isAuthenticated, isRestoring, sessionExpired } = useAuth()
  const location = useLocation()

  // Wait for the silent refresh before deciding the session is gone.
  if (isRestoring) {
    return <DashboardLoadingFallback />
  }

  // Guard dashboard pages; unauthenticated users always go back to login.
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: getCurrentDashboardPath(location),
          sessionExpired: Boolean(sessionExpired),
        }}
      />
    )
  }

  return children
}

function DashboardLoadingFallback() {
  return (
    <div className="dashboard-route-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>Loading dashboard</span>
    </div>
  )
}

function LazyDashboardRoute({ children }) {
  return (
    <Suspense fallback={<DashboardLoadingFallback />}>
      {children}
    </Suspense>
  )
}

export function DashboardRouteBoundary({ children }) {
  const location = useLocation()
  return <DashboardErrorBoundary resetKey={location.pathname}>{children}</DashboardErrorBoundary>
}

export default function App() {
  return (
    <Routes>
      {/* Main route map. Dashboard children render inside AdminDashboard through <Outlet />. */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardRouteBoundary>
              <LazyDashboardRoute>
                <AdminDashboard />
              </LazyDashboardRoute>
            </DashboardRouteBoundary>
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={
            <LazyDashboardRoute>
              <DashboardSection />
            </LazyDashboardRoute>
          }
        />
        <Route
          path="live"
          element={
            <LazyDashboardRoute>
              <LiveSection />
            </LazyDashboardRoute>
          }
        />
        <Route
          path="downtime"
          element={
            <LazyDashboardRoute>
              <DowntimeSection />
            </LazyDashboardRoute>
          }
        />
        <Route
          path="reports"
          element={
            <RequireRole roles={['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Managing Director']}>
              <LazyDashboardRoute>
                <ReportsSection />
              </LazyDashboardRoute>
            </RequireRole>
          }
        />
        <Route
          path="analytics"
          element={
            <RequireRole roles={['Admin', 'Operation Manager', 'Asst. Operation Manager', 'Engineering Supervisor', 'Managing Director']}>
              <LazyDashboardRoute>
                <AnalyticsSection />
              </LazyDashboardRoute>
            </RequireRole>
          }
        />
        <Route
          path="users"
          element={
            /* Admin-only account management route. */
            <RequireRole roles={['Admin']}>
              <LazyDashboardRoute>
                <UsersSection />
              </LazyDashboardRoute>
            </RequireRole>
          }
        />
        <Route
          path="machines"
          element={
            <RequireRole roles={['Admin', 'Engineering Supervisor']}>
              <LazyDashboardRoute>
                <MachinesSection />
              </LazyDashboardRoute>
            </RequireRole>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRole roles={['Admin']}>
              <LazyDashboardRoute>
                <AuditSection />
              </LazyDashboardRoute>
            </RequireRole>
          }
        />
        <Route
          path="settings"
          element={
            <RequireRole roles={['Admin']}>
              <LazyDashboardRoute>
                <SettingsSection />
              </LazyDashboardRoute>
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
