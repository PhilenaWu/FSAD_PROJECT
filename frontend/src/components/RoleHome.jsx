// /dashboard content switch: managers get the UC-005 analytics dashboard,
// inspectors get their own landing page, everyone else (residents) gets the
// resident home page.
import { useAuth } from '../context/AuthContext';
import DashboardPage from '../pages/DashboardPage';
import HomePage from '../pages/HomePage';
import InspectorHomePage from '../pages/InspectorHomePage';

export default function RoleHome() {
  const { profile } = useAuth();
  if (profile?.role === 'manager') return <DashboardPage />;
  if (profile?.role === 'inspector') return <InspectorHomePage />;
  return <HomePage />;
}
