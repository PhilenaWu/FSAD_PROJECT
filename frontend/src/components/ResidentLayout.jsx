// Shared RESIDENT app layout: a top header (logo, nav, notification placeholder,
// user menu) above the routed page via <Outlet />. Nav is driven by role so a
// manager variant can be added later without reworking this component.
// On small screens (below md) the nav links collapse into a hamburger drawer;
// the brand, bell, and avatar stay visible. Uses theme tokens only — no hex.
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  AppBar,
  Avatar,
  Box,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ApartmentIcon from '@mui/icons-material/Apartment';
import MenuIcon from '@mui/icons-material/Menu';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './notifications/NotificationBell';

// Nav items per role. Add a `manager` key here when the manager header lands —
// the rest of this component stays unchanged.
const NAV_BY_ROLE = {
  resident: [
    { label: 'Home', to: '/dashboard', icon: HomeOutlinedIcon },
    { label: 'Report issue', to: '/report', icon: AddCircleOutlineIcon },
    { label: 'My reports', to: '/my-reports', icon: AssignmentOutlinedIcon },
    { label: 'Status board', to: '/status-board', icon: GridViewOutlinedIcon },
  ],
  inspector: [
    { label: 'New inspection', to: '/inspections/new', icon: AssignmentOutlinedIcon },
  ],
};

const ROLE_LABEL = { resident: 'Resident', inspector: 'Inspector', manager: 'Manager' };

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
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer if the viewport grows to desktop (e.g. rotate/resize)
  // so it can't linger open once the inline nav is showing again.
  useEffect(() => {
    if (isDesktop) setMobileNavOpen(false);
  }, [isDesktop]);

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
            {/* Hamburger — mobile only; opens the nav drawer. */}
            <IconButton
              aria-label="Open navigation menu"
              color="inherit"
              edge="start"
              onClick={() => setMobileNavOpen(true)}
              sx={{ display: { xs: 'inline-flex', md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>

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
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
                }}
              >
                <ApartmentIcon />
              </Box>
              <Typography variant="h6" fontWeight={700} color="text.primary" noWrap>
                EM Services
              </Typography>
            </Stack>

            {/* Nav (role-driven). Inline on md+; hidden on xs/sm (see drawer). */}
            <Stack
              direction="row"
              spacing={{ xs: 1, sm: 2 }}
              alignItems="center"
              sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }}
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
                      color: active ? 'primary.main' : 'text.secondary',
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

            {/* Mobile-only spacer: keeps the right-side controls pushed to the end
                when the inline nav (the desktop spacer) is hidden. */}
            <Box sx={{ flexGrow: 1, display: { xs: 'block', md: 'none' } }} />

            {/* Right: live notification bell (UC-008) + user menu */}
            <Stack direction="row" spacing={1} alignItems="center">
              <NotificationBell />

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
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
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

      {/* Mobile navigation drawer — same role-driven items as the inline nav. */}
      <Drawer
        anchor="left"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      >
        <Box sx={{ width: 260 }} role="presentation">
          {/* Brand header for context inside the drawer. */}
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 2 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 2,
                color: 'primary.main',
                bgcolor: (t) => alpha(t.palette.primary.main, 0.1),
              }}
            >
              <ApartmentIcon fontSize="small" />
            </Box>
            <Typography variant="subtitle1" fontWeight={700} color="text.primary" noWrap>
              EM Services
            </Typography>
          </Stack>

          <Divider />

          <List>
            {navItems.map(({ label, to, icon: Icon }) => {
              const active = location.pathname === to;
              return (
                <ListItemButton
                  key={to}
                  component={Link}
                  to={to}
                  selected={active}
                  onClick={() => setMobileNavOpen(false)}
                  sx={{ color: active ? 'primary.main' : 'text.secondary' }}
                >
                  <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={label}
                    primaryTypographyProps={{ fontWeight: active ? 700 : 500 }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </Drawer>

      <Outlet />
    </Box>
  );
}
