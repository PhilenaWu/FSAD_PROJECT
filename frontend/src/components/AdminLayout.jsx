// ADMIN app chrome: picks the admin sidebar nav items (UC-011 cost analytics,
// UC-012 vendor lifecycle), then hands off to the shared AppShell for the
// actual sidebar/top-bar/Outlet rendering.
import AppShell from './AppShell';
import { useRoleContacts } from '../lib/useRoleContacts';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';

const NAV_ITEMS = [
  { label: 'Cost Analytics', to: '/admin/costs', icon: PaymentsOutlinedIcon },
  { label: 'Vendors', to: '/admin/vendors', icon: HandshakeOutlinedIcon },
  { label: 'Reports', to: '/reports', icon: DescriptionOutlinedIcon },
];

// Item 28: the contacts page the help card's number comes from — the card
// dials one manager, the page lists them all plus the estate line.
const QUICK_ACCESS_ITEMS = [
  { label: 'Contacts', to: '/emergency-contacts', icon: LocalPhoneOutlinedIcon },
];

export default function AdminLayout() {
  // "Need urgent help?" number for an admin is the estate manager's — the
  // manager runs the estate day to day, so they are who an admin calls. Read
  // from the users table (migration 038) rather than hardcoded, so it stays
  // right when the manager on duty changes. First manager holding a number
  // wins, which on the seeded data is Rachel Lim. Falls back to the default
  // support card while loading or if no manager has published a number.
  const { helpPhone, helpCaption } = useRoleContacts();

  return (
    <AppShell
      navItems={NAV_ITEMS}
      accountSubtitle="Administrator"
      profileLinkEnabled
      quickAccessItems={QUICK_ACCESS_ITEMS}
      helpPhone={helpPhone}
      helpCaption={helpCaption}
    />
  );
}
