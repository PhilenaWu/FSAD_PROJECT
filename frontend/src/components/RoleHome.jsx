// /dashboard content switch: managers get the UC-005 analytics dashboard,
// inspectors get their own landing page, everyone else (residents) gets the
// resident home page.
// DashboardPage and HomePage are both lazy-loaded: each pulls in Chart.js and
// its own chart component tree, which the other roles never need — splitting
// keeps every role's first paint free of the chart weight it doesn't use.
import { lazy, Suspense } from 'react';
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
  return (
    <Suspense fallback={<PageLoader />}>
      <HomePage />
    </Suspense>
  );
}
