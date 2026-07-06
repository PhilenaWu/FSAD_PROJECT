// Shared RESIDENT app layout: a top header (logo, nav, notification placeholder,
// user menu) above the routed page via <Outlet />. Nav is driven by role so a
// manager variant can be added later without reworking this component.
// Uses theme tokens only — no hardcoded colours.
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Container,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ApartmentIcon from '@mui/icons-material/Apartment';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../context/AuthContext';

// Nav items per role. Add a `manager` key here when the manager header lands —
// the rest of this component stays unchanged.
const NAV_BY_ROLE = {
  resident: [
    { label: 'Home', to: '/dashboard', icon: HomeOutlinedIcon },
    { label: 'Report issue', to: '/report', icon: AddCircleOutlineIcon },
    { label: 'My reports', to: '/my-reports', icon: AssignmentOutlinedIcon },
  ],
};

const ROLE_LABEL = { resident: 'Resident', manager: 'Manager' };

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

export default function ResidentLayout() {
  const { user, profile, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState(null);

  const role = profile?.role ?? 'resident';
  const navItems = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.resident;

  const fullName = profile?.full_name ?? '';
  const roleLabel = ROLE_LABEL[role] ?? role;
  // e.g. "Resident · Block 44A #12-05" — block/unit fill in once profile loads.
  const subtitle =
    profile?.block_number || profile?.unit_number
      ? `${roleLabel} · Block ${profile.block_number ?? '—'} #${profile.unit_number ?? '—'}`
      : roleLabel;

  async function handleLogout() {
    setMenuAnchor(null);
    // logout() doesn't self-redirect, and ProtectedRoute only checks on mount,
    // so send the user to /login explicitly.
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="static"
        elevation={0}
        color="transparent"
        sx={{
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ gap: { xs: 1, sm: 3 } }}>
            {/* Left: logo mark + wordmark */}
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mr: { xs: 0, sm: 2 } }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: 2,
                  color: 'primary.main',
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                }}
              >
                <ApartmentIcon />
              </Box>
              <Typography variant="h6" fontWeight={700} color="text.primary" noWrap>
                EM Services
              </Typography>
            </Stack>

            {/* Nav (role-driven). Active link underlined in primary red. */}
            <Stack
              direction="row"
              spacing={{ xs: 1, sm: 2 }}
              alignItems="center"
              sx={{ flexGrow: 1 }}
            >
              {navItems.map(({ label, to, icon: Icon }) => {
                const active = location.pathname === to;
                return (
                  <Stack
                    key={to}
                    component={Link}
                    to={to}
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    sx={{
                      textDecoration: 'none',
                      py: 2.5,
                      color: active ? 'primary.main' : 'text.primary',
                      borderBottom: 2,
                      borderColor: active ? 'primary.main' : 'transparent',
                      fontWeight: active ? 700 : 500,
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    <Icon fontSize="small" />
                    <Typography variant="body1" sx={{ fontWeight: 'inherit' }} noWrap>
                      {label}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>

            {/* Right: notification placeholder + user menu */}
            <Stack direction="row" spacing={1} alignItems="center">
              {/* Placeholder only — UC-008 not built, so this bell does nothing. */}
              <IconButton aria-label="Notifications (coming soon)" color="inherit" disabled>
                <Badge color="primary" variant="dot">
                  <NotificationsNoneOutlinedIcon />
                </Badge>
              </IconButton>

              <Divider orientation="vertical" flexItem sx={{ my: 1.5 }} />

              <IconButton
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                aria-label="Account menu"
                size="small"
              >
                <Avatar
                  sx={{
                    width: 36,
                    height: 36,
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'primary.main',
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                  }}
                >
                  {initialsFrom(fullName, user?.email)}
                </Avatar>
              </IconButton>
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
                  {subtitle}
                </Typography>
              </Box>

              <Divider />

              {/* Stub — no profile page yet (disabled placeholder). */}
              <MenuItem disabled>
                <PersonOutlineIcon fontSize="small" sx={{ mr: 1.5 }} />
                Profile
              </MenuItem>

              <MenuItem onClick={handleLogout} sx={{ color: 'primary.main' }}>
                <LogoutIcon fontSize="small" sx={{ mr: 1.5 }} />
                Log out
              </MenuItem>
            </Menu>
          </Toolbar>
        </Container>
      </AppBar>

      <Outlet />
    </Box>
  );
}
