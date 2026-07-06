import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from './components/ProtectedRoute'
import ResidentLayout from './components/ResidentLayout'
import LoginPage from './pages/LoginPage'
import ReportIssuePage from './pages/ReportIssuePage'
import IncidentListPage from './pages/IncidentListPage'
import IncidentDetailPage from './pages/IncidentDetailPage'
import MyReportsPage from './pages/MyReportsPage'
import DashboardPage from './pages/DashboardPage'
import ReportsArchivePage from './pages/ReportsArchivePage'
import NotificationsPage from './pages/NotificationsPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Protected: ProtectedRoute renders these via <Outlet /> only when authed */}
      <Route element={<ProtectedRoute />}>
        {/* Resident pages share the resident header/layout. Managers get a
            separate layout later, so their pages stay outside this group. */}
        <Route element={<ResidentLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/report" element={<ReportIssuePage />} />
          <Route path="/my-reports" element={<MyReportsPage />} />
        </Route>

        {/* Other protected pages (manager/other) — no resident header for now. */}
        <Route path="/incidents" element={<IncidentListPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/reports" element={<ReportsArchivePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
      </Route>

      {/* Anything else (including /) lands on the dashboard, which bounces to
          /login when there's no token. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
