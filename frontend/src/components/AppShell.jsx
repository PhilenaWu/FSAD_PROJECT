// Shared chrome for all three role layouts (Resident, Manager, Admin):
// a fixed left sidebar (nav) + a slim top bar (notifications, account menu)
// above the routed page via <Outlet />. Role-specific bits (nav items,
// account subtitle, whether "Profile" links anywhere) are passed in as props
// so ResidentLayout/ManagerLayout/AdminLayout stay small and own their own
// role logic — this component only owns the shared visual shell.
// On small screens the sidebar becomes a hamburger-triggered drawer.
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import ApartmentIcon from '@mui/icons-material/Apartment';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import HeadsetMicOutlinedIcon from '@mui/icons-material/HeadsetMicOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './notifications/NotificationBell';
import AccountMenu from './AccountMenu';

const DRAWER_WIDTH = 264;

function BrandRow() {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, height: 64 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 2,
          color: '#ffffff',
          bgcolor: 'primary.main',
        }}
      >
        <ApartmentIcon fontSize="small" />
      </Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ color: 'sidebar.textActive' }} noWrap>
        EM Services
      </Typography>
    </Stack>
  );
}

function NavList({ navItems, currentPath, onNavigate, sectionLabel }) {
  return (
    <List
      subheader={
        sectionLabel ? (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              px: 2,
              pt: 1.5,
              pb: 0.5,
              color: 'sidebar.text',
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {sectionLabel}
          </Typography>
        ) : undefined
      }
      sx={{ px: 1.5, py: sectionLabel ? 0 : 1 }}
    >
      {navItems.map(({ label, to, icon: Icon, badgeCount }) => {
        const active = currentPath === to;
        return (
          <ListItemButton
            key={to}
            component={Link}
            to={to}
            selected={active}
            onClick={onNavigate}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              color: active ? 'sidebar.textActive' : 'sidebar.text',
              '&.Mui-selected': {
                bgcolor: 'sidebar.activeBg',
                '&:hover': { bgcolor: 'sidebar.activeBg' },
              },
              '&:hover': { bgcolor: 'sidebar.hoverBg', color: 'sidebar.textActive' },
            }}
          >
            <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={label}
              primaryTypographyProps={{ fontWeight: active ? 700 : 500, fontSize: '0.9rem' }}
            />
            {/* Optional count pill (e.g. pending resident requests). Hidden at
                zero so the sidebar only draws the eye when there's work. */}
            {badgeCount > 0 && (
              <Chip
                size="small"
                label={badgeCount}
                color="primary"
                sx={{ height: 20, minWidth: 20, '& .MuiChip-label': { px: 0.75, fontWeight: 700 } }}
              />
            )}
          </ListItemButton>
        );
      })}
    </List>
  );
}

// Sidebar footer card. Two variants:
// - `helpPhone` given: "Need urgent help?" + `helpCaption` naming who picks up
//   + a real tel: link. Both values come from lib/roleContacts.js per role.
// - otherwise: "Contact support" — no support email/route exists anywhere in
//   the app yet, so the button stays disabled rather than silently going
//   nowhere on click (roles with no number configured yet).
function HelpCard({ helpPhone, helpCaption }) {
  return (
    <Box sx={{ p: 1.5 }}>
      <Box
        sx={{
          p: 2,
          borderRadius: 2,
          bgcolor: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid',
          borderColor: 'sidebar.border',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: 'rgba(255, 255, 255, 0.1)',
              color: 'sidebar.textActive',
            }}
          >
            <HeadsetMicOutlinedIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            {helpPhone ? (
              <>
                <Typography variant="body2" fontWeight={700} sx={{ color: 'sidebar.textActive' }}>
                  Need urgent help?
                </Typography>
                {helpCaption && (
                  <Typography variant="caption" sx={{ color: 'sidebar.text', display: 'block', mb: 0.5 }}>
                    {helpCaption}
                  </Typography>
                )}
                <Typography
                  component="a"
                  href={`tel:${helpPhone.replace(/\s+/g, '')}`}
                  variant="body2"
                  fontWeight={700}
                  sx={{ color: 'sidebar.textActive', textDecoration: 'none' }}
                >
                  {helpPhone}
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="body2" fontWeight={700} sx={{ color: 'sidebar.textActive' }}>
                  Need help?
                </Typography>
                <Typography variant="caption" sx={{ color: 'sidebar.text', display: 'block', mb: 1 }}>
                  Our support team is here to assist you.
                </Typography>
                <Button
                  size="small"
                  disabled
                  endIcon={<ArrowForwardIcon fontSize="small" />}
                  sx={{
                    color: 'sidebar.textActive',
                    borderColor: 'sidebar.border',
                    '&.Mui-disabled': { color: 'sidebar.text', borderColor: 'sidebar.border' },
                  }}
                  variant="outlined"
                >
                  Contact support
                </Button>
              </>
            )}
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}

/**
 * @param {{label: string, to: string, icon: React.ElementType, badgeCount?: number}[]} navItems
 *   badgeCount renders a small count pill on the row; omitted or 0 renders none
 * @param {string} accountSubtitle - text under the name in the account menu
 * @param {boolean} profileLinkEnabled - whether "Profile" navigates to /profile
 *   (false renders it as a disabled placeholder, matching the pre-redesign
 *   resident menu which has no profile page wired up yet)
 * @param {{label: string, to: string, icon: React.ElementType}[]} [quickAccessItems] -
 *   optional second nav section (e.g. Emergency contacts/FAQ/Feedback)
 * @param {string} [helpPhone] - if given, the sidebar footer shows this as a
 *   real "Need urgent help?" tel: link instead of the disabled support button
 * @param {string} [helpCaption] - line under "Need urgent help?" naming who
 *   answers that number (e.g. "Call your managing office")
 * @param {boolean} [showLogoutInSidebar] - also show a direct Logout row at
 *   the foot of the sidebar (logout is always available from the account menu
 *   regardless)
 */
export default function AppShell({
  navItems,
  accountSubtitle,
  profileLinkEnabled,
  quickAccessItems,
  helpPhone,
  helpCaption,
  showLogoutInSidebar,
}) {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // For the sidebar's direct Logout row only — the account-menu Logout item
  // lives in AccountMenu.
  async function handleLogout() {
    // logout() doesn't self-redirect, and ProtectedRoute only checks on mount,
    // so send the user to /login explicitly.
    await logout();
    navigate('/login', { replace: true });
  }

  const sidebarContent = (
    <Box
      role="presentation"
      sx={{ height: '100%', bgcolor: 'sidebar.bg', display: 'flex', flexDirection: 'column' }}
    >
      <BrandRow />
      <Divider sx={{ borderColor: 'sidebar.border' }} />
      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
        <NavList
          navItems={navItems}
          currentPath={location.pathname}
          onNavigate={() => setMobileNavOpen(false)}
        />
        {quickAccessItems?.length > 0 && (
          <>
            <Divider sx={{ borderColor: 'sidebar.border', mx: 1.5 }} />
            <NavList
              navItems={quickAccessItems}
              currentPath={location.pathname}
              onNavigate={() => setMobileNavOpen(false)}
              sectionLabel="Quick access"
            />
          </>
        )}
      </Box>
      {showLogoutInSidebar && (
        <List sx={{ px: 1.5, pt: 0 }}>
          <ListItemButton
            onClick={handleLogout}
            sx={{
              borderRadius: 2,
              color: 'sidebar.text',
              '&:hover': { bgcolor: 'sidebar.hoverBg', color: 'sidebar.textActive' },
            }}
          >
            <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Logout" primaryTypographyProps={{ fontWeight: 500, fontSize: '0.9rem' }} />
          </ListItemButton>
        </List>
      )}
      <HelpCard helpPhone={helpPhone} helpCaption={helpCaption} />
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Mobile drawer — temporary, opened via the top-bar hamburger. */}
      <Drawer
        variant="temporary"
        anchor="left"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            bgcolor: 'sidebar.bg',
          },
        }}
      >
        {sidebarContent}
      </Drawer>

      {/* Desktop sidebar — fixed, permanent. */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'sidebar.border',
            bgcolor: 'sidebar.bg',
          },
        }}
        open
      >
        {sidebarContent}
      </Drawer>

      {/* Content column: top bar + routed page. */}
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="sticky"
          elevation={0}
          color="transparent"
          sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
        >
          <Toolbar sx={{ gap: 1.5 }}>
            <IconButton
              aria-label="Open navigation menu"
              edge="start"
              onClick={() => setMobileNavOpen(true)}
              sx={{ display: { xs: 'inline-flex', md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>

            <Box sx={{ flexGrow: 1 }} />

            <Stack direction="row" spacing={1} alignItems="center">
              <NotificationBell />

              <Divider orientation="vertical" flexItem sx={{ my: 1.5 }} />

              <AccountMenu accountSubtitle={accountSubtitle} profileLinkEnabled={profileLinkEnabled} />
            </Stack>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flexGrow: 1 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
