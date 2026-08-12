// Profile page — the signed-in user's own details from the `users` profile
// row (via AuthContext). Reached from the header account menu.
//
// Residents get an editable version: full name and contact phone save through
// PATCH /api/users/me (block/unit stay read-only — those are managed by the
// office, and email/password live in Supabase Auth). Staff roles keep the
// original read-only card.
import { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { useAuth } from '../context/AuthContext';
import { updatePassword } from '../lib/auth';
import { PASSWORD_RULES, checkPassword, isValidPassword } from '../utils/validation';
import api from '../services/api';

// Field rows shown when the profile has a value for them.
const FIELDS = [
  ['Full name', 'full_name'],
  ['Email', 'email'],
  ['Block', 'block_number'],
  ['Unit', 'unit_number'],
];

function ProfileHeader({ user, profile }) {
  const initials = (profile?.full_name || user?.email || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
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
  );
}

// Live per-rule checklist under the new-password field — same rules as the
// registration form (utils/validation.js), so the two never disagree.
function PasswordChecklist({ password }) {
  const results = checkPassword(password);
  return (
    <Stack spacing={0.25} sx={{ mt: 0.5 }}>
      {PASSWORD_RULES.map((rule) => {
        const ok = results[rule.key];
        return (
          <Stack key={rule.key} direction="row" spacing={0.75} alignItems="center">
            {ok ? (
              <CheckCircleOutlineIcon sx={{ fontSize: 14 }} color="success" />
            ) : (
              <RadioButtonUncheckedIcon sx={{ fontSize: 14 }} color="disabled" />
            )}
            <Typography variant="caption" color={ok ? 'success.main' : 'text.secondary'}>
              {rule.label}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

// Change password — collapsed behind a toggle so the page stays compact. The
// credential lives in Supabase Auth, so this calls updateUser client-side;
// no backend endpoint is involved.
function ChangePasswordSection({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const valid = isValidPassword(password);
  const match = password === confirm;

  const handleUpdate = async () => {
    setSaving(true);
    setError(null);
    const { error: updateError } = await updatePassword(password);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPassword('');
    setConfirm('');
    setOpen(false);
    onSaved();
  };

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          Password
        </Typography>
        <Button size="small" onClick={() => setOpen((o) => !o)}>
          {open ? 'Cancel' : 'Change password'}
        </Button>
      </Stack>

      <Collapse in={open}>
        <Stack spacing={2} sx={{ mb: 2 }}>
          <Box>
            <TextField
              label="New password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              size="small"
              fullWidth
              autoComplete="new-password"
            />
            <PasswordChecklist password={password} />
          </Box>
          <TextField
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            size="small"
            fullWidth
            autoComplete="new-password"
            error={confirm.length > 0 && !match}
            helperText={confirm.length > 0 && !match ? 'Passwords do not match.' : ' '}
          />

          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={handleUpdate}
              disabled={!valid || !match || saving}
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {saving ? 'Updating…' : 'Update password'}
            </Button>
          </Stack>
        </Stack>
      </Collapse>
    </>
  );
}

// Resident variant: name + phone editable, everything else read-only.
function ResidentProfile({ user, profile, reloadProfile }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [toast, setToast] = useState(null); // snackbar text, or null

  // Seed (and re-seed after reloadProfile) the drafts from the profile row.
  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile]);

  const dirty =
    fullName !== (profile?.full_name ?? '') || phone !== (profile?.phone ?? '');

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch('/api/users/me', { full_name: fullName, phone });
      setToast('Profile updated');
      reloadProfile(); // sync AuthContext so the header shows the new name
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Could not save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <ProfileHeader user={user} profile={profile} />
      <Divider sx={{ mb: 2 }} />

      {/* Residence details — read-only, changed via the managing office. */}
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between">
          <Typography color="text.secondary">Email</Typography>
          <Typography fontWeight={600}>{profile?.email || user?.email}</Typography>
        </Stack>
        {profile?.block_number && (
          <Stack direction="row" justifyContent="space-between">
            <Typography color="text.secondary">Block</Typography>
            <Typography fontWeight={600}>{profile.block_number}</Typography>
          </Stack>
        )}
        {profile?.unit_number && (
          <Stack direction="row" justifyContent="space-between">
            <Typography color="text.secondary">Unit</Typography>
            <Typography fontWeight={600}>{profile.unit_number}</Typography>
          </Stack>
        )}
      </Stack>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
        Contact details
      </Typography>
      <Stack spacing={2} sx={{ mb: 2 }}>
        <TextField
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          size="small"
          fullWidth
          inputProps={{ maxLength: 255 }}
        />
        <TextField
          label="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          size="small"
          fullWidth
          placeholder="e.g. 9123 4567"
          inputProps={{ maxLength: 30 }}
          helperText="Used by the managing office to reach you about your reports."
        />
      </Stack>

      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError}
        </Alert>
      )}

      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!dirty || saving || !fullName.trim()}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </Stack>

      <Divider sx={{ mb: 2 }} />
      <ChangePasswordSection onSaved={() => setToast('Password updated')} />

      <Alert severity="info" sx={{ mt: 2 }}>
        Moving out, or need your block or unit updated? Contact the managing
        office — residence details are maintained by EM Services.
      </Alert>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Paper>
  );
}

// Staff variant — the original read-only card.
function StaffProfile({ user, profile }) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <ProfileHeader user={user} profile={profile} />
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
  );
}

export default function ProfilePage() {
  const { user, profile, profileLoading, reloadProfile } = useAuth();
  const isResident = profile?.role === 'resident';

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 640, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        Profile
      </Typography>

      {/* profile is briefly null while reloadProfile() refetches after a save —
          a spinner beats flashing the wrong variant. */}
      {profileLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : isResident ? (
        <ResidentProfile user={user} profile={profile} reloadProfile={reloadProfile} />
      ) : (
        <StaffProfile user={user} profile={profile} />
      )}
    </Box>
  );
}
