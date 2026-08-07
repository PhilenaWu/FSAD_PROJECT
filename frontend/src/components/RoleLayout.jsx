// Picks the layout to render for the signed-in user's role, then renders the
// routed page via <Outlet/> inside it. While the profile is still loading we
// show a spinner instead of guessing a role — guessing "resident" here was
// what flashed/stranded managers in the resident workspace.
import { useNavigate } from 'react-router';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import { useAuth } from '../context/AuthContext';
import ResidentLayout from './ResidentLayout';
import ManagerLayout from './ManagerLayout';
import AdminLayout from './AdminLayout';
import ContractorLayout from './ContractorLayout';

export default function RoleLayout() {
  const { profile, profileLoading, suspended, accountBlocked, logout } = useAuth();
  const navigate = useNavigate();

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

  // A suspended account (UC-012 expired/terminated vendor, or any account an
  // admin has disabled) signs in to Supabase but is refused by /api/users/me,
  // so its role is never known. Say so plainly instead of falling through to
  // resident chrome, which looked like the app had simply lost their role.
  if (suspended) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Paper elevation={2} sx={{ p: 4, borderRadius: 3, maxWidth: 460 }}>
          <Stack spacing={2} alignItems="flex-start">
            <Stack direction="row" spacing={1} alignItems="center">
              <BlockOutlinedIcon color="error" />
              <Typography variant="h6" fontWeight={700}>
                Account suspended
              </Typography>
            </Stack>
            <Alert severity="error" sx={{ width: '100%' }}>
              This account has been suspended and cannot access the platform.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              If you believe this is a mistake, contact the estate administrator.
              Vendor accounts are suspended automatically when their contract
              expires.
            </Typography>
            <Button
              variant="contained"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  // A self-registered resident whose request is still pending (or was
  // rejected). Login already turns these away, but a session restored from a
  // previous tab lands here — same reasoning as the suspended branch above:
  // say why rather than falling through to resident chrome they cannot use.
  if (accountBlocked) {
    const pending = accountBlocked === 'pending';
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Paper elevation={2} sx={{ p: 4, borderRadius: 3, maxWidth: 460 }}>
          <Stack spacing={2} alignItems="flex-start">
            <Stack direction="row" spacing={1} alignItems="center">
              {pending ? (
                <HourglassEmptyOutlinedIcon color="warning" />
              ) : (
                <BlockOutlinedIcon color="error" />
              )}
              <Typography variant="h6" fontWeight={700}>
                {pending ? 'Awaiting approval' : 'Request not approved'}
              </Typography>
            </Stack>
            <Alert severity={pending ? 'info' : 'error'} sx={{ width: '100%' }}>
              {pending
                ? 'Your account is awaiting manager approval.'
                : 'Your registration request was not approved.'}
            </Alert>
            <Typography variant="body2" color="text.secondary">
              {pending
                ? 'A manager is verifying the block and unit you gave against the estate records. You will be able to sign in once they approve your request.'
                : 'If you believe this is a mistake, contact the managing office.'}
            </Typography>
            <Button
              variant="contained"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  // Unknown role (profile fetch failed for another reason): resident chrome is
  // the safe default.
  if (profile?.role === 'manager') return <ManagerLayout />;
  if (profile?.role === 'admin') return <AdminLayout />;
  if (profile?.role === 'contractor') return <ContractorLayout />;
  return <ResidentLayout />;
}
