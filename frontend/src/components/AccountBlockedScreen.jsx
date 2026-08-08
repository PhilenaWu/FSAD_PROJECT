// Why an authenticated user is not being let in. Rendered by ProtectedRoute in
// place of the app — never inside it — so a refused account never mounts a
// portal, the same hard stop "not signed in" gets.
//
// Three reasons, all of which authenticate at Supabase perfectly well and are
// refused by our own profile check:
//   suspended — UC-012 expired/terminated vendor, or an account an admin
//               disabled.
//   pending   — a self-registered resident a manager has not approved yet.
//   rejected  — one whose request was refused.
import { useNavigate } from 'react-router';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import { useAuth } from '../context/AuthContext';

const REASONS = {
  suspended: {
    icon: BlockOutlinedIcon,
    iconColor: 'error',
    title: 'Access revoked',
    severity: 'error',
    alert: 'This account no longer has access — its access has been revoked.',
    detail:
      'If you believe this is a mistake, contact the estate administrator. Vendor accounts are revoked automatically when their contract expires.',
  },
  pending: {
    icon: HourglassEmptyOutlinedIcon,
    iconColor: 'warning',
    title: 'Awaiting approval',
    severity: 'info',
    alert: 'Your account is awaiting manager approval.',
    detail:
      'A manager is verifying the block and unit you gave against the estate records. You will be able to sign in once they approve your request.',
  },
  rejected: {
    icon: BlockOutlinedIcon,
    iconColor: 'error',
    title: 'Request not approved',
    severity: 'error',
    alert: 'Your registration request was not approved.',
    detail: 'If you believe this is a mistake, contact the managing office.',
  },
};

/** @param {'suspended'|'pending'|'rejected'} reason */
export default function AccountBlockedScreen({ reason }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { icon: Icon, iconColor, title, severity, alert, detail } =
    REASONS[reason] ?? REASONS.suspended;

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
            <Icon color={iconColor} />
            <Typography variant="h6" fontWeight={700}>
              {title}
            </Typography>
          </Stack>
          <Alert severity={severity} sx={{ width: '100%' }}>
            {alert}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {detail}
          </Typography>
          {/* The session is dropped on the way out, not as a separate "sign
              out" step: leaving it alive would send LoginPage straight back
              into the app, which bounces the user back to this screen. */}
          <Button
            variant="contained"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            Back to login
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
