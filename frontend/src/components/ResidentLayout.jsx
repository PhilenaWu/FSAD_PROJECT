// RESIDENT/INSPECTOR app chrome: picks the role-specific sidebar nav items
// and account-menu subtitle, then hands off to the shared AppShell for the
// actual sidebar/top-bar/Outlet rendering.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getRoleContacts } from '../lib/roleContacts';
import { listDirectory } from '../services/contactService';
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

// Sidebar "Quick access" section. Residents get the full set; inspectors get
// only the contacts page (FAQ and Feedback are resident-facing).
const QUICK_ACCESS_BY_ROLE = {
  resident: [
    { label: 'Emergency contacts', to: '/emergency-contacts', icon: LocalPhoneOutlinedIcon },
    { label: 'FAQ', to: '/faq', icon: HelpOutlineOutlinedIcon },
    { label: 'Feedback', to: '/feedback', icon: StarOutlinedIcon },
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
  // Sidebar help card values — same source the contacts page reads.
  const { helpPhone: fallbackPhone, helpCaption } = getRoleContacts(role);

  // The resident help line is also a row in contact_directory (migration
  // 039, flagged is_help_line), so the number can be corrected without a
  // redeploy. roleContacts.js stays the caption and the fallback used while
  // this loads or if the request fails — both say 6500 0300 today.
  //
  // Residents only, deliberately: is_help_line marks ONE global row (the
  // managing office). An inspector's card is the estate manager instead, a
  // different number the directory cannot express per role, so overriding
  // for every role here would quietly undo that choice.
  const [directoryPhone, setDirectoryPhone] = useState(undefined);

  useEffect(() => {
    if (role !== 'resident') return undefined;
    let active = true;
    listDirectory()
      .then((res) => {
        if (active) setDirectoryPhone(res.data.find((c) => c.is_help_line)?.phone);
      })
      .catch(() => {
        // Keep the roleContacts value rather than blanking the card.
      });
    return () => {
      active = false;
    };
  }, [role]);

  const helpPhone = directoryPhone ?? fallbackPhone;

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
      quickAccessItems={QUICK_ACCESS_BY_ROLE[role]}
      helpPhone={helpPhone}
      helpCaption={helpCaption}
      showLogoutInSidebar={role === 'resident'}
    />
  );
}
