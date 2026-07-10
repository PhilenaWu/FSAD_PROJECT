// Picks the layout to render for the signed-in user's role, then renders the
// routed page via <Outlet/> inside it. profile is briefly null right after
// login (still fetching /api/users/me) — defaults to resident, matching the
// same fallback ResidentLayout already uses internally.
import { useAuth } from '../context/AuthContext';
import ResidentLayout from './ResidentLayout';
import ManagerLayout from './ManagerLayout';

export default function RoleLayout() {
  const { profile } = useAuth();
  const role = profile?.role ?? 'resident';
  return role === 'manager' ? <ManagerLayout /> : <ResidentLayout />;
}
