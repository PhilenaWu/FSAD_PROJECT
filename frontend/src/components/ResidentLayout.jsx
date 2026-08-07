// RESIDENT/INSPECTOR app chrome: picks the role-specific sidebar nav items
// and account-menu subtitle, then hands off to the shared AppShell for the
// actual sidebar/top-bar/Outlet rendering.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import AppShell from './AppShell';
import { listDirectory } from '../services/contactService';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';

// Nav items per role. Managers, admins and contractors have their own layout
// components; this one serves residents and inspectors.
const NAV_BY_ROLE = {
  resident: [
    { label: 'Home', to: '/dashboard', icon: HomeOutlinedIcon },
    { label: 'Report issue', to: '/report', icon: AddCircleOutlineIcon },
    { label: 'My reports', to: '/my-reports', icon: AssignmentOutlinedIcon },
    { label: 'Status board', to: '/status-board', icon: GridViewOutlinedIcon },
    { label: 'Notices', to: '/notices', icon: CampaignOutlinedIcon },
  ],
  inspector: [
    { label: 'Home', to: '/dashboard', icon: HomeOutlinedIcon },
    { label: 'New inspection', to: '/inspections/new', icon: AddCircleOutlineIcon },
    { label: 'My inspections', to: '/my-reports', icon: AssignmentOutlinedIcon },
    { label: 'Completed work', to: '/inspections', icon: FactCheckOutlinedIcon },
  ],
};

// Sidebar "Quick access" section — resident only (matches the resident home
// redesign this was requested for; inspectors keep the plain nav).
const RESIDENT_QUICK_ACCESS = [
  { label: 'Emergency contacts', to: '/emergency-contacts', icon: LocalPhoneOutlinedIcon },
  { label: 'FAQ', to: '/faq', icon: HelpOutlineOutlinedIcon },
  { label: 'Feedback', to: '/feedback', icon: StarOutlinedIcon },
];

const ROLE_LABEL = {
  resident: 'Resident',
  inspector: 'Inspector',
  manager: 'Manager',
  contractor: 'Contractor',
};

export default function ResidentLayout() {
  const { profile } = useAuth();
  const role = profile?.role ?? 'resident';
  const navItems = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.resident;
  const roleLabel = ROLE_LABEL[role] ?? role;

  // "Need help?" number for a resident is the managing office line, read from
  // the contact directory (migration 039) rather than hardcoded — the literal
  // that used to sit here was fabricated and matched nothing else in the app.
  // Only residents show the card, so only residents fetch it.
  const [helpPhone, setHelpPhone] = useState(undefined);

  useEffect(() => {
    if (role !== 'resident') return undefined;
    let active = true;
    listDirectory()
      .then((res) => {
        if (active) setHelpPhone(res.data.find((c) => c.is_help_line)?.phone);
      })
      .catch(() => {
        // Leave it undefined — the sidebar shows the default support card.
      });
    return () => {
      active = false;
    };
  }, [role]);

  // e.g. "Resident · Block 44A #12-05" — block/unit fill in once profile loads.
  const accountSubtitle =
    profile?.block_number || profile?.unit_number
      ? `${roleLabel} · Block ${profile.block_number ?? '—'} #${profile.unit_number ?? '—'}`
      : roleLabel;

  return (
    <AppShell
      navItems={navItems}
      accountSubtitle={accountSubtitle}
      // No profile page wired up for residents/inspectors yet — placeholder only.
      profileLinkEnabled={false}
      quickAccessItems={role === 'resident' ? RESIDENT_QUICK_ACCESS : undefined}
      helpPhone={helpPhone}
      showLogoutInSidebar={role === 'resident'}
    />
  );
}
