import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from './components/ProtectedRoute'
import RoleLayout from './components/RoleLayout'
import RoleHome from './components/RoleHome'
import PageLoader from './components/PageLoader'
import LoginPage from './pages/LoginPage'
import ReportIssuePage from './pages/ReportIssuePage'
import InspectionListPage from './pages/InspectionListPage'
import InspectionDetailPage from './pages/InspectionDetailPage'
import InspectionHistoryPage from './pages/InspectionHistoryPage'
import MyReportsPage from './pages/MyReportsPage'
import NewInspectionPage from './pages/NewInspectionPage'
import StatusBoardPage from './pages/StatusBoardPage'
import ReportsArchivePage from './pages/ReportsArchivePage'
import NotificationsPage from './pages/NotificationsPage'
import ProfilePage from './pages/ProfilePage'
import ContractorInboxPage from './pages/ContractorInboxPage'

// Admin pages are lazy-loaded: only the admin role ever visits them, and the
// cost dashboard carries its own Chart.js panels — no other role should pay
// for that in the initial bundle. (RoleHome lazy-loads the UC-005 dashboard
// the same way.)
const AdminCostPage = lazy(() => import('./pages/AdminCostPage'))
const AdminVendorPage = lazy(() => import('./pages/AdminVendorPage'))

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
          <Route path="/inspections" element={<InspectionListPage />} />
          {/* Ahead of /:id so 'history' isn't captured as an inspection id. */}
          <Route path="/inspections/history" element={<InspectionHistoryPage />} />
          <Route path="/inspections/:id" element={<InspectionDetailPage />} />
          <Route path="/reports" element={<ReportsArchivePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          {/* Contractor portal (UC-010). */}
          <Route path="/contractor-inbox" element={<ContractorInboxPage />} />
          <Route
            path="/admin/costs"
            element={
              <Suspense fallback={<PageLoader />}>
                <AdminCostPage />
              </Suspense>
            }
          />
          <Route
            path="/admin/vendors"
            element={
              <Suspense fallback={<PageLoader />}>
                <AdminVendorPage />
              </Suspense>
            }
          />
        </Route>
      </Route>

      {/* Anything else (including /) lands on the dashboard, which bounces to
          /login when there's no token. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
