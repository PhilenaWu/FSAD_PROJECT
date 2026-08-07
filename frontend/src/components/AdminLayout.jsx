// ADMIN app chrome: picks the admin sidebar nav items (UC-011 cost analytics,
// UC-012 vendor lifecycle), then hands off to the shared AppShell for the
// actual sidebar/top-bar/Outlet rendering.
import { useEffect, useState } from 'react';
import AppShell from './AppShell';
import { getRoleContacts } from '../lib/roleContacts';
import { listContacts } from '../services/userService';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';

const NAV_ITEMS = [
  { label: 'Cost Analytics', to: '/admin/costs', icon: PaymentsOutlinedIcon },
  { label: 'Vendors', to: '/admin/vendors', icon: HandshakeOutlinedIcon },
  { label: 'Reports', to: '/reports', icon: DescriptionOutlinedIcon },
];

export default function AdminLayout() {
  // "Need urgent help?" number for an admin is the estate manager's — the
  // manager runs the estate day to day, so they are who an admin calls. Read
  // from the users table (migration 038) rather than hardcoded, so it stays
  // right when the manager on duty changes. First manager holding a number
  // wins, which on the seeded data is Rachel Lim. Falls back to the default
  // support card while loading or if no manager has published a number.
  // Caption and fallback number from the shared per-role source; the live
  // number below overrides it. Same pattern as ResidentLayout.
  const { helpPhone: fallbackPhone, helpCaption } = getRoleContacts('admin');
  const [managerPhone, setManagerPhone] = useState(undefined);

  useEffect(() => {
    let active = true;
    listContacts()
      .then((res) => {
        if (active) setManagerPhone(res.data.find((c) => c.phone)?.phone);
      })
      .catch(() => {
        // Leave it undefined — the sidebar shows the default support card.
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell
      navItems={NAV_ITEMS}
      accountSubtitle="Administrator"
      profileLinkEnabled
      // Value only — AppShell is Philena's until her per-role help/contacts
      // component lands (items 2/22), so the caption stays her hardcoded
      // "Call your managing office" for now. Naming the manager explicitly is
      // hers to add once the component takes a per-role label.
      helpPhone={managerPhone ?? fallbackPhone}
      helpCaption={helpCaption}
    />
  );
}
