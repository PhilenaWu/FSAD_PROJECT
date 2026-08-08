// The single gate into the app. Nested routes render only for a signed-in
// account the backend actually admits; everything else stops here, before any
// portal chrome mounts.
//
// Refusal used to be split across two layers: this component checked the token,
// and RoleLayout — already inside the app — explained a suspended or unapproved
// account. That left two holes. The token was read once on mount, so signing
// out from the refusal screen did not send the user back to /login; and with
// the session gone, RoleLayout saw no role and fell through to its resident
// default, dropping a suspended user into the resident portal moments after
// telling them they were suspended. Reading auth state from context makes this
// react to sign-out, and refusing here means "suspended" stops a user exactly
// where "not signed in" does.
import { Navigate, Outlet } from 'react-router';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import AccountBlockedScreen from './AccountBlockedScreen';

function FullPageSpinner() {
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

export default function ProtectedRoute() {
  const { user, loading, profileLoading, suspended, accountBlocked } = useAuth();

  // Still restoring the session — render nothing rather than flash the login
  // page at someone who is signed in.
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  // Signed in, but we do not yet know whether they are admitted. Waiting here
  // keeps the portal from mounting for an account about to be refused.
  if (profileLoading) return <FullPageSpinner />;

  if (suspended) return <AccountBlockedScreen reason="suspended" />;
  if (accountBlocked) return <AccountBlockedScreen reason={accountBlocked} />;

  return <Outlet />;
}
