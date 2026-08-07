// Single source of truth for the per-role "who do I call?" values. Two places
// read from here, so a role's number is written once and always agrees with
// itself:
//   - the sidebar footer help card (AppShell's HelpCard)
//   - the Emergency contacts page (/emergency-contacts)
//
// To add a role, fill in its block below — do not edit AppShell.jsx or
// EmergencyContactsPage.jsx, they read whatever is here.
//
// Shape per role (every field optional):
//   helpPhone         number in the sidebar card. Leave it out and the card
//                     falls back to the disabled "Contact support" state.
//   helpCaption       one line under "Need urgent help?" naming who picks up.
//   contactsTitle     heading on /emergency-contacts.
//   contactsSubtitle  line under that heading.
//   contacts[]        the rows: { label, description, number, icon, color }.
//                     `icon` is a MUI icon component, `color` a palette key
//                     ('primary' | 'info' | 'error' | 'warning' | 'success').
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import LocalPoliceOutlinedIcon from '@mui/icons-material/LocalPoliceOutlined';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import SupervisorAccountOutlinedIcon from '@mui/icons-material/SupervisorAccountOutlined';

// Every number the app shows lives here, so swapping one swaps it everywhere.
// The managing office is deliberately one number across roles — residents and
// inspectors calling "the office" reach the same desk.
const MANAGING_OFFICE = '6500 0300';
const ESTATE_MANAGER = '6500 0322';

export const ROLE_CONTACTS = {
  // --- resident (item 2) ---
  // Managing office is the estate's own line; Police and Fire & Ambulance are
  // Singapore's national emergency numbers.
  resident: {
    helpPhone: MANAGING_OFFICE,
    helpCaption: 'Call your managing office',
    contactsTitle: 'Emergency contacts',
    contactsSubtitle: 'For urgent estate issues or emergencies.',
    contacts: [
      {
        label: 'Managing office',
        description: 'Estate maintenance, lift faults, general enquiries',
        number: MANAGING_OFFICE,
        icon: ApartmentOutlinedIcon,
        color: 'primary',
      },
      {
        label: 'Police',
        description: 'National emergency line',
        number: '999',
        icon: LocalPoliceOutlinedIcon,
        color: 'info',
      },
      {
        label: 'Fire & Ambulance',
        description: 'National emergency line',
        number: '995',
        icon: LocalFireDepartmentOutlinedIcon,
        color: 'error',
      },
    ],
  },

  // --- inspector (item 22) ---
  // Not a per-contractor list: `contractors` holds several maintenance
  // companies assigned per lift brand (Otis/Schindler/KONE in the seed), so no
  // one number is "the contractor". An inspector calls the maintenance line
  // and the office dispatches whoever services that defect; the estate manager
  // handles everything that is not a repair.
  inspector: {
    helpPhone: ESTATE_MANAGER,
    helpCaption: 'Call the estate manager',
    contactsTitle: 'Contacts',
    contactsSubtitle: 'Who to call while you are on site.',
    contacts: [
      {
        label: 'Estate maintenance',
        description: 'Dispatches all defect types — lift, structural, graffiti',
        number: MANAGING_OFFICE,
        icon: BuildOutlinedIcon,
        color: 'warning',
      },
      {
        label: 'Estate manager',
        description: 'Scheduling, access, escalations',
        number: ESTATE_MANAGER,
        icon: SupervisorAccountOutlinedIcon,
        color: 'primary',
      },
    ],
  },

  // --- manager (items 4 + 28: admin contact number, managers' info) ---
  // manager: { ... },

  // --- contractor (item 16: manager's number) ---
  // contractor: { ... },

  // --- admin (item 27 drops the help card, so no helpPhone here) ---
  // admin: { ... },
};

/** Values for a role; `{}` for a role nobody has filled in yet. */
export function getRoleContacts(role) {
  return ROLE_CONTACTS[role] ?? {};
}
