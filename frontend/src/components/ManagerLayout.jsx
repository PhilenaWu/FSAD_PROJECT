// MANAGER app chrome: picks the manager sidebar nav items, then hands off to
// the shared AppShell for the actual sidebar/top-bar/Outlet rendering.
import { useEffect, useState } from 'react';
import AppShell from './AppShell';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import { listPendingResidents, listContacts } from '../services/userService';

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/dashboard', icon: GridViewOutlinedIcon },
  { label: 'Inspections', to: '/inspections', icon: WarningAmberOutlinedIcon },
  { label: 'Resident requests', to: '/pending-residents', icon: HowToRegOutlinedIcon },
  { label: 'Reports', to: '/reports', icon: DescriptionOutlinedIcon },
  { label: 'Notifications', to: '/notifications', icon: CampaignOutlinedIcon },
];

export default function ManagerLayout() {
  // Badge count for "Resident requests" — a self-registered resident is locked
  // out until someone acts, so the sidebar has to show that work is waiting.
  // Fetched once per mount; the count drops as the approval page clears rows.
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let active = true;
    listPendingResidents()
      .then((res) => {
        if (active) setPendingCount(res.data.length);
      })
      .catch(() => {
        // No badge rather than an error: the nav entry still works.
      });
    return () => {
      active = false;
    };
  }, []);

  // "Need help?" number for a manager is the admin's — they are who a manager
  // escalates to. Read from the users table (migration 038) rather than
  // hardcoded, so it stays right when the admin on duty changes. First admin
  // holding a number wins; the card falls back to the disabled support button
  // while this is loading or if no admin has one.
  const [adminPhone, setAdminPhone] = useState(undefined);

  useEffect(() => {
    let active = true;
    listContacts()
      .then((res) => {
        if (active) setAdminPhone(res.data.find((c) => c.phone)?.phone);
      })
      .catch(() => {
        // Leave it undefined — the sidebar shows the default support card.
      });
    return () => {
      active = false;
    };
  }, []);

  const navItems = NAV_ITEMS.map((item) =>
    item.to === '/pending-residents' ? { ...item, badgeCount: pendingCount } : item
  );

  return (
    <AppShell
      navItems={navItems}
      accountSubtitle="Estate manager"
      profileLinkEnabled
      // Value only — AppShell is Philena's until her per-role help/contacts
      // component lands (items 2/22). Until then the card's caption is her
      // hardcoded "Call your managing office"; the per-role wording is hers to
      // add, and this passes the number in through the prop that already exists.
      helpPhone={adminPhone}
    />
  );
}
