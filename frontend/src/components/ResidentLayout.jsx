// RESIDENT/INSPECTOR app chrome: picks the role-specific sidebar nav items
// and account-menu subtitle, then hands off to the shared AppShell for the
// actual sidebar/top-bar/Outlet rendering.
import { useAuth } from '../context/AuthContext';
import AppShell from './AppShell';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';

// Nav items per role. Add a `manager` key here when the manager header lands —
// the rest of this component stays unchanged.
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
      // Fabricated for the resident home redesign at the requester's explicit
      // instruction — not a real managing-office number.
      helpPhone={role === 'resident' ? '1800-123-4567' : undefined}
      showLogoutInSidebar={role === 'resident'}
    />
  );
}
