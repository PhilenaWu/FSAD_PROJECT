// RESIDENT/INSPECTOR app chrome: picks the role-specific sidebar nav items
// and account-menu subtitle, then hands off to the shared AppShell for the
// actual sidebar/top-bar/Outlet rendering.
import { useAuth } from '../context/AuthContext';
import { useRoleContacts } from '../lib/useRoleContacts';
import AppShell from './AppShell';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';

// Nav items per role. Managers, admins and contractors have their own layout
// components; this one serves residents and inspectors.
const NAV_BY_ROLE = {
  resident: [
    { label: 'Home', to: '/dashboard', icon: HomeOutlinedIcon },
    { label: 'Report issue', to: '/report', icon: AddCircleOutlineIcon },
    { label: 'My reports', to: '/my-reports', icon: AssignmentOutlinedIcon },
    { label: 'Status board', to: '/status-board', icon: GridViewOutlinedIcon },
  ],
  inspector: [
    { label: 'Home', to: '/dashboard', icon: HomeOutlinedIcon },
    { label: 'New inspection', to: '/inspections/new', icon: AddCircleOutlineIcon },
    { label: 'My inspections', to: '/my-reports', icon: AssignmentOutlinedIcon },
    { label: 'Needs your review', to: '/inspections', icon: FactCheckOutlinedIcon },
  ],
};

// Sidebar "Quick access" section. Residents get the full set; inspectors get
// only the contacts page (FAQ and Feedback are resident-facing).
const QUICK_ACCESS_BY_ROLE = {
  resident: [
    { label: 'Emergency contacts', to: '/emergency-contacts', icon: LocalPhoneOutlinedIcon },
    { label: 'FAQ', to: '/faq', icon: HelpOutlineOutlinedIcon },
  ],
  inspector: [
    { label: 'Contacts', to: '/emergency-contacts', icon: LocalPhoneOutlinedIcon },
  ],
};

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
  // Sidebar help card — same hook the contacts page reads, so the two never
  // disagree. A resident's number is the directory row flagged is_help_line
  // (the managing office); an inspector's is the estate manager's own, which
  // is a different kind of number the directory cannot express per role. Both
  // come from the database, so correcting one needs no redeploy.
  const { helpPhone, helpCaption } = useRoleContacts();

  // e.g. "Resident · Block 44A #12-05" — block/unit fill in once profile loads.
  const accountSubtitle =
    profile?.block_number || profile?.unit_number
      ? `${roleLabel} · Block ${profile.block_number ?? '—'} #${profile.unit_number ?? '—'}`
      : roleLabel;

  return (
    <AppShell
      navItems={navItems}
      accountSubtitle={accountSubtitle}
      // Residents get the editable profile page; inspectors the read-only card.
      profileLinkEnabled
      quickAccessItems={QUICK_ACCESS_BY_ROLE[role]}
      helpPhone={helpPhone}
      helpCaption={helpCaption}
      showLogoutInSidebar={role === 'resident'}
    />
  );
}
