// Profile page — the signed-in user's own details from the `users` profile
// row (via AuthContext). Read-only; reached from the header account menu.
import {
  Alert,
  Avatar,
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAuth } from '../context/AuthContext';

// Field rows shown when the profile has a value for them.
const FIELDS = [
  ['Full name', 'full_name'],
  ['Email', 'email'],
  ['Block', 'block_number'],
  ['Unit', 'unit_number'],
];

export default function ProfilePage() {
  const { user, profile } = useAuth();

  const initials = (profile?.full_name || user?.email || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 640, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        Profile
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Avatar
            sx={{
              width: 56,
              height: 56,
              fontWeight: 600,
              color: 'primary.main',
              bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
            }}
          >
            {initials}
          </Avatar>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {profile?.full_name || user?.email}
            </Typography>
            {profile?.role && (
              <Chip label={profile.role} size="small" color="primary" variant="outlined" sx={{ textTransform: 'capitalize' }} />
            )}
          </Box>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.5} sx={{ mb: 2 }}>
          {FIELDS.filter(([, key]) => profile?.[key]).map(([label, key]) => (
            <Stack key={key} direction="row" justifyContent="space-between">
              <Typography color="text.secondary">{label}</Typography>
              <Typography fontWeight={600}>{profile[key]}</Typography>
            </Stack>
          ))}
          {profile?.status && (
            <Stack direction="row" justifyContent="space-between">
              <Typography color="text.secondary">Account status</Typography>
              <Typography fontWeight={600} sx={{ textTransform: 'capitalize' }}>
                {profile.status}
              </Typography>
            </Stack>
          )}
        </Stack>

        <Alert severity="info">
          Staff accounts are provisioned by HR. To change your login details or
          role, contact the estate administrator.
        </Alert>
      </Paper>
    </Box>
  );
}
