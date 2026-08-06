// Avatar + dropdown chevron + account menu (name/subtitle, Profile, Logout).
// Extracted out of AppShell so the top-bar account menu is a single component
// rather than inline JSX.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, Box, Divider, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LogoutIcon from '@mui/icons-material/Logout';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useAuth } from '../context/AuthContext';

// "Marcus Tan" -> "MT". Falls back to the email's first letter.
function initialsFrom(fullName, email) {
  const name = (fullName || '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

/**
 * @param {string} accountSubtitle - text under the name in the account menu
 * @param {boolean} profileLinkEnabled - whether "Profile" navigates to /profile
 */
export default function AccountMenu({ accountSubtitle, profileLinkEnabled }) {
  const { user, profile, logout } = useAuth();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState(null);

  const fullName = profile?.full_name ?? '';

  async function handleLogout() {
    setMenuAnchor(null);
    // logout() doesn't self-redirect, and ProtectedRoute only checks on mount,
    // so send the user to /login explicitly.
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        component="button"
        type="button"
        onClick={(e) => setMenuAnchor(e.currentTarget)}
        aria-label="Account menu"
        sx={{
          border: 'none',
          bgcolor: 'transparent',
          p: 0.5,
          borderRadius: 2,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Avatar
          sx={{
            width: 36,
            height: 36,
            fontSize: 14,
            fontWeight: 600,
            color: 'primary.main',
            bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
          }}
        >
          {initialsFrom(fullName, user?.email)}
        </Avatar>
        <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240, mt: 1 } } }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} color="text.primary" noWrap>
            {fullName || user?.email || 'Account'}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {accountSubtitle}
          </Typography>
        </Box>

        <Divider />

        <MenuItem
          disabled={!profileLinkEnabled}
          onClick={
            profileLinkEnabled
              ? () => {
                  setMenuAnchor(null);
                  navigate('/profile');
                }
              : undefined
          }
        >
          <PersonOutlineIcon fontSize="small" sx={{ mr: 1.5 }} />
          Profile
        </MenuItem>

        <MenuItem onClick={handleLogout} sx={{ color: 'primary.main' }}>
          <LogoutIcon fontSize="small" sx={{ mr: 1.5 }} />
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}
