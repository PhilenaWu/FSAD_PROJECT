// /dashboard content switch: managers get the UC-005 analytics dashboard,
// everyone else (residents, inspectors) gets the resident home page. Keeps the
// manager nav's /dashboard target intact without touching DashboardPage.
import { useAuth } from '../context/AuthContext';
import DashboardPage from '../pages/DashboardPage';
import HomePage from '../pages/HomePage';

export default function RoleHome() {
  const { profile } = useAuth();
  return profile?.role === 'manager' ? <DashboardPage /> : <HomePage />;
}
