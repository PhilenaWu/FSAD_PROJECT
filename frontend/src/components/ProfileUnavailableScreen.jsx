// Shown when the signed-in user's profile could not be loaded at all — as
// opposed to loading fine and saying "refused", which AccountBlockedScreen
// handles.
//
// Before this existed, RoleLayout treated an unreadable profile as a resident:
// no role known, so resident chrome was the "safe default". It wasn't. A vendor
// whose profile row is missing, or anyone hitting a backend error, was quietly
// dropped into someone else's workspace. Not knowing who someone is has to look
// like an error, not like a resident.
//
// The retry is worth offering because the most common cause is a cold start on
// the free tier — AuthContext already retries transient failures twice before
// giving up, so reaching this screen means those retries were used up.
import { useNavigate } from 'react-router';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useAuth } from '../context/AuthContext';

export default function ProfileUnavailableScreen() {
  const { logout, reloadProfile } = useAuth();
  const navigate = useNavigate();

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
            <ErrorOutlineIcon color="error" />
            <Typography variant="h6" fontWeight={700}>
              Could not load your account
            </Typography>
          </Stack>
          <Alert severity="error" sx={{ width: '100%' }}>
            You are signed in, but we could not read your account details.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            This is usually temporary — try again in a moment. If it keeps
            happening, contact the estate administrator, as the account may not
            be set up correctly.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={reloadProfile}>
              Try again
            </Button>
            <Button
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Back to login
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
