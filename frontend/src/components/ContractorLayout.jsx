// CONTRACTOR app chrome: picks the contractor sidebar nav items, then hands
// off to the shared AppShell for the actual sidebar/top-bar/Outlet rendering.
// Structural clone of ManagerLayout.jsx — contractors previously had their own
// bespoke top-AppBar layout; this brings them onto the same shell as every
// other role (Manager/Admin/Resident).
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import AppShell from './AppShell';
import { useAuth } from '../context/AuthContext';
import { useRoleContacts } from '../lib/useRoleContacts';

// The inbox is the contractor's whole workspace — no dashboard, no archive.
const NAV_ITEMS = [
  { label: 'My jobs', to: '/contractor-inbox', icon: BuildOutlinedIcon },
  { label: 'Notifications', to: '/notifications', icon: CampaignOutlinedIcon },
];

export default function ContractorLayout() {
  const { profile } = useAuth();
  // e.g. "Contractor · VP Operations" — job_title is the vendor account
  // holder's position (migration 020) and is often blank.
  const accountSubtitle = profile?.job_title
    ? `Contractor · ${profile.job_title}`
    : 'Contractor';

  // "Need help?" number for a contractor is the estate manager's — who assigns
  // the defect and who a blocked contractor escalates to. Read from the users
  // table (migration 038) rather than hardcoded, so it stays right when the
  // manager on duty changes. First manager holding a number wins; the card
  // falls back to the disabled support button while loading or if none has one.
  const { helpPhone, helpCaption } = useRoleContacts();

  return (
    <AppShell
      navItems={NAV_ITEMS}
      accountSubtitle={accountSubtitle}
      profileLinkEnabled
      helpPhone={helpPhone}
      helpCaption={helpCaption}
    />
  );
}
