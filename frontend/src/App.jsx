import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from './components/ProtectedRoute'
import RoleLayout from './components/RoleLayout'
import RoleHome from './components/RoleHome'
import WorkspacePlaceholder from './components/WorkspacePlaceholder'
import LoginPage from './pages/LoginPage'
import ReportIssuePage from './pages/ReportIssuePage'
import InspectionListPage from './pages/InspectionListPage'
import InspectionDetailPage from './pages/InspectionDetailPage'
import MyReportsPage from './pages/MyReportsPage'
import NewInspectionPage from './pages/NewInspectionPage'
import StatusBoardPage from './pages/StatusBoardPage'
import ReportsArchivePage from './pages/ReportsArchivePage'
import NotificationsPage from './pages/NotificationsPage'
import ProfilePage from './pages/ProfilePage'
import CvReviewPage from './pages/CvReviewPage'
import AdminVendorPage from './pages/AdminVendorPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Protected: ProtectedRoute renders these via <Outlet /> only when authed */}
      <Route element={<ProtectedRoute />}>
        {/* RoleLayout picks resident vs manager chrome per profile.role, then
            all protected pages render inside it via <Outlet />. */}
        <Route element={<RoleLayout />}>
          {/* Managers see the analytics dashboard; other roles the home page. */}
          <Route path="/dashboard" element={<RoleHome />} />
          <Route path="/report" element={<ReportIssuePage />} />
          <Route path="/my-reports" element={<MyReportsPage />} />
          <Route path="/status-board" element={<StatusBoardPage />} />
          <Route path="/inspections/new" element={<NewInspectionPage />} />
          <Route path="/cv-review" element={<CvReviewPage />} />
          <Route path="/inspections" element={<InspectionListPage />} />
          <Route path="/inspections/:id" element={<InspectionDetailPage />} />
          <Route path="/reports" element={<ReportsArchivePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          {/* Role landing pages not built yet — placeholder, not an error. */}
          <Route path="/contractor-inbox" element={<WorkspacePlaceholder />} />
          <Route path="/admin/costs" element={<WorkspacePlaceholder />} />
          <Route path="/admin/vendors" element={<AdminVendorPage />} />
        </Route>
      </Route>

      {/* Anything else (including /) lands on the dashboard, which bounces to
          /login when there's no token. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
