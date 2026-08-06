// MANAGER app chrome: picks the manager sidebar nav items, then hands off to
// the shared AppShell for the actual sidebar/top-bar/Outlet rendering.
import AppShell from './AppShell';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/dashboard', icon: GridViewOutlinedIcon },
  { label: 'Inspections', to: '/inspections', icon: WarningAmberOutlinedIcon },
  { label: 'Reports', to: '/reports', icon: DescriptionOutlinedIcon },
  { label: 'Notifications', to: '/notifications', icon: CampaignOutlinedIcon },
];

export default function ManagerLayout() {
  return (
    <AppShell navItems={NAV_ITEMS} accountSubtitle="Estate manager" profileLinkEnabled />
  );
}
