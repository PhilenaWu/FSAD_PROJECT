import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import ProtectedRoute from './components/ProtectedRoute'
import RoleLayout from './components/RoleLayout'
import RoleHome from './components/RoleHome'
import PageLoader from './components/PageLoader'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import PendingResidentsPage from './pages/PendingResidentsPage'
import ReportIssuePage from './pages/ReportIssuePage'
import InspectionListPage from './pages/InspectionListPage'
import InspectionDetailPage from './pages/InspectionDetailPage'
import InspectionHistoryPage from './pages/InspectionHistoryPage'
import MyReportsPage from './pages/MyReportsPage'
import NewInspectionPage from './pages/NewInspectionPage'
import ReportsArchivePage from './pages/ReportsArchivePage'
import NotificationsPage from './pages/NotificationsPage'
import ProfilePage from './pages/ProfilePage'
import ContractorInboxPage from './pages/ContractorInboxPage'
import EmergencyContactsPage from './pages/EmergencyContactsPage'
import FAQPage from './pages/FAQPage'
import FeedbackPage from './pages/FeedbackPage'
import NoticesPage from './pages/NoticesPage'

// Admin pages are lazy-loaded: only the admin role ever visits them, and the
// cost dashboard carries its own Chart.js panels — no other role should pay
// for that in the initial bundle. (RoleHome lazy-loads the UC-005 dashboard
// the same way.) StatusBoardPage's KPI sparklines pull in Chart.js too, and
// it's resident/inspector-only, so it gets the same treatment.
const AdminCostPage = lazy(() => import('./pages/AdminCostPage'))
const AdminVendorPage = lazy(() => import('./pages/AdminVendorPage'))
const StatusBoardPage = lazy(() => import('./pages/StatusBoardPage'))

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Public: anyone may submit a registration request. Approval is what
          gates access, not the route. */}
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected: ProtectedRoute renders these via <Outlet /> only when authed */}
      <Route element={<ProtectedRoute />}>
        {/* RoleLayout picks resident vs manager chrome per profile.role, then
            all protected pages render inside it via <Outlet />. */}
        <Route element={<RoleLayout />}>
          {/* Managers see the analytics dashboard; other roles the home page. */}
          <Route path="/dashboard" element={<RoleHome />} />
          <Route path="/report" element={<ReportIssuePage />} />
          <Route path="/my-reports" element={<MyReportsPage />} />
          <Route
            path="/status-board"
            element={
              <Suspense fallback={<PageLoader />}>
                <StatusBoardPage />
              </Suspense>
            }
          />
          <Route path="/inspections/new" element={<NewInspectionPage />} />
          <Route path="/inspections" element={<InspectionListPage />} />
          {/* Ahead of /:id so 'history' isn't captured as an inspection id. */}
          <Route path="/inspections/history" element={<InspectionHistoryPage />} />
          <Route path="/inspections/:id" element={<InspectionDetailPage />} />
          <Route path="/reports" element={<ReportsArchivePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          {/* Manager-only approval queue for resident self-registrations. */}
          <Route path="/pending-residents" element={<PendingResidentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          {/* Contractor portal (UC-010). */}
          <Route path="/contractor-inbox" element={<ContractorInboxPage />} />
          {/* Sidebar "quick access" pages. */}
          <Route path="/emergency-contacts" element={<EmergencyContactsPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/notices" element={<NoticesPage />} />
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
