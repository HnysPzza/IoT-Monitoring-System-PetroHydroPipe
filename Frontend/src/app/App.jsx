import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../shared/session/AuthContext.jsx'
import RequireRole from '../shared/components/RequireRole.jsx'
import LoginPage from '../features/auth/LoginPage.jsx'
import AdminDashboard from '../features/dashboard/layout/AdminDashboard.jsx'
import AuditSection from '../features/dashboard/audit/AuditSection.jsx'
import DashboardSection from '../features/dashboard/overview/DashboardSection.jsx'
import DowntimeSection from '../features/dashboard/downtime/DowntimeSection.jsx'
import LiveSection from '../features/dashboard/live/LiveSection.jsx'
import MachinesSection from '../features/dashboard/machines/MachinesSection.jsx'
import ReportsSection from '../features/dashboard/reports/ReportsSection.jsx'
import SettingsSection from '../features/dashboard/settings/SettingsSection.jsx'
import UsersSection from '../features/dashboard/users/UsersSection.jsx'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardSection />} />
        <Route path="live" element={<LiveSection />} />
        <Route path="downtime" element={<DowntimeSection />} />
        <Route path="reports" element={<ReportsSection />} />
        <Route
          path="users"
          element={
            <RequireRole roles={['Admin']}>
              <UsersSection />
            </RequireRole>
          }
        />
        <Route
          path="machines"
          element={
            <RequireRole roles={['Admin', 'Engineering Supervisor']}>
              <MachinesSection />
            </RequireRole>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRole roles={['Admin']}>
              <AuditSection />
            </RequireRole>
          }
        />
        <Route
          path="settings"
          element={
            <RequireRole roles={['Admin']}>
              <SettingsSection />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
