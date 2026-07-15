// Picks the layout to render for the signed-in user's role, then renders the
// routed page via <Outlet/> inside it. While the profile is still loading we
// show a spinner instead of guessing a role — guessing "resident" here was
// what flashed/stranded managers in the resident workspace.
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import ResidentLayout from './ResidentLayout';
import ManagerLayout from './ManagerLayout';
import AdminLayout from './AdminLayout';

export default function RoleLayout() {
  const { profile, profileLoading } = useAuth();

  if (profileLoading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // Profile fetch failed / unknown role: resident chrome is the safe default.
  if (profile?.role === 'manager') return <ManagerLayout />;
  if (profile?.role === 'admin') return <AdminLayout />;
  return <ResidentLayout />;
}
