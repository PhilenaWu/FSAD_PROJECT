// ADMIN app chrome: picks the admin sidebar nav items (UC-011 cost analytics,
// UC-012 vendor lifecycle), then hands off to the shared AppShell for the
// actual sidebar/top-bar/Outlet rendering.
import AppShell from './AppShell';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';

const NAV_ITEMS = [
  { label: 'Cost Analytics', to: '/admin/costs', icon: PaymentsOutlinedIcon },
  { label: 'Vendors', to: '/admin/vendors', icon: HandshakeOutlinedIcon },
  { label: 'Reports', to: '/reports', icon: DescriptionOutlinedIcon },
];

export default function AdminLayout() {
  return (
    <AppShell navItems={NAV_ITEMS} accountSubtitle="Administrator" profileLinkEnabled />
  );
}
