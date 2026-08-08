// /dashboard content switch: managers get the UC-005 analytics dashboard,
// inspectors get their own landing page, and the roles with no home page of
// their own — contractor, admin — are sent to the first entry in their sidebar
// nav. Everyone else (residents) gets the resident home page.
//
// The admin redirect matters because /dashboard is also the catch-all target
// for any unrecognised URL: without it an admin landed on the resident home
// page, quick actions and all.
// The analytics dashboard is lazy-loaded: it pulls in Chart.js and the whole
// chart component tree, which residents and inspectors never need — splitting
// it keeps their first paint free of that weight.
import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import PageLoader from './PageLoader';
import InspectorHomePage from '../pages/InspectorHomePage';

const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const HomePage = lazy(() => import('../pages/HomePage'));

export default function RoleHome() {
  const { profile } = useAuth();
  if (profile?.role === 'manager') {
    return (
      <Suspense fallback={<PageLoader />}>
        <DashboardPage />
      </Suspense>
    );
  }
  if (profile?.role === 'inspector') return <InspectorHomePage />;
  // Contractors have no home page of their own — their inbox is the workspace.
  if (profile?.role === 'contractor') return <Navigate to="/contractor-inbox" replace />;
  // Nor do admins — cost analytics is the first thing in their nav.
  if (profile?.role === 'admin') return <Navigate to="/admin/costs" replace />;
  return (
    <Suspense fallback={<PageLoader />}>
      <HomePage />
    </Suspense>
  );

}
