// /dashboard content switch: managers get the UC-005 analytics dashboard,
// inspectors get their own landing page, everyone else (residents) gets the
// resident home page.
// The analytics dashboard is lazy-loaded: it pulls in Chart.js and the whole
// chart component tree, which residents and inspectors never need — splitting
// it keeps their first paint free of that weight.
import { lazy, Suspense } from 'react';
import { useAuth } from '../context/AuthContext';
import PageLoader from './PageLoader';
import HomePage from '../pages/HomePage';
import InspectorHomePage from '../pages/InspectorHomePage';

const DashboardPage = lazy(() => import('../pages/DashboardPage'));

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
  return <HomePage />;
}
