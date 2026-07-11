import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from './components/ProtectedRoute'
import RoleLayout from './components/RoleLayout'
import WorkspacePlaceholder from './components/WorkspacePlaceholder'
import LoginPage from './pages/LoginPage'
import ReportIssuePage from './pages/ReportIssuePage'
import IncidentListPage from './pages/IncidentListPage'
import IncidentDetailPage from './pages/IncidentDetailPage'
import MyReportsPage from './pages/MyReportsPage'
import NewInspectionPage from './pages/NewInspectionPage'
import DashboardPage from './pages/DashboardPage'
import ReportsArchivePage from './pages/ReportsArchivePage'
import NotificationsPage from './pages/NotificationsPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Protected: ProtectedRoute renders these via <Outlet /> only when authed */}
      <Route element={<ProtectedRoute />}>
        {/* RoleLayout picks resident vs manager chrome per profile.role, then
            all protected pages render inside it via <Outlet />. */}
        <Route element={<RoleLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/report" element={<ReportIssuePage />} />
          <Route path="/my-reports" element={<MyReportsPage />} />
          <Route path="/inspections/new" element={<NewInspectionPage />} />
          <Route path="/incidents" element={<IncidentListPage />} />
          <Route path="/incidents/:id" element={<IncidentDetailPage />} />
          <Route path="/reports" element={<ReportsArchivePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          {/* Role landing pages not built yet — placeholder, not an error. */}
          <Route path="/contractor-inbox" element={<WorkspacePlaceholder />} />
          <Route path="/admin/costs" element={<WorkspacePlaceholder />} />
        </Route>
      </Route>

      {/* Anything else (including /) lands on the dashboard, which bounces to
          /login when there's no token. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
