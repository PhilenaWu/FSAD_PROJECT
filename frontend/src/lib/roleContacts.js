// Per-role recipe for the "who do I call?" surfaces. Two places read from here:
//   - the sidebar footer help card (AppShell's HelpCard)
//   - the Emergency contacts page (/emergency-contacts)
//
// There are deliberately NO phone numbers in this file. Every number the app
// shows comes from the database via useRoleContacts():
//   - contact_directory (migration 039) — the managing office and the national
//     emergency lines, which are organisations rather than user accounts.
//   - users.phone (migration 038) — a member of staff's own number, served by
//     GET /api/users/contacts, which maps the caller's role to its counterpart
//     server-side so no role can enumerate numbers it has no business seeing.
// What lives here is only what the database cannot express: which sources a
// role draws on, and the wording/iconography around them.
//
// To add a role, fill in its block below — do not edit AppShell.jsx or
// EmergencyContactsPage.jsx, they render whatever is here.
//
// Shape per role (every field optional):
//   helpSource        where the sidebar card's number comes from:
//                     'directory' (the row flagged is_help_line) or 'staff'
//                     (the first counterpart who has published a number).
//                     Omit and the card falls back to "Contact support".
//   helpCaption       one line under "Need urgent help?" naming who picks up.
//   contactsTitle     heading on /emergency-contacts.
//   contactsSubtitle  line under that heading.
//   directoryCategories  which contact_directory categories the contacts page
//                     lists ('estate' | 'emergency'). Omit for none.
//   staffLabel        role name shown beside each staff contact's own name on
//                     the contacts page (e.g. "Estate manager"). Omit to leave
//                     staff off the page entirely — the sidebar card can still
//                     use helpSource: 'staff'.
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import LocalPoliceOutlinedIcon from '@mui/icons-material/LocalPoliceOutlined';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import SupervisorAccountOutlinedIcon from '@mui/icons-material/SupervisorAccountOutlined';

// contact_directory.icon_key -> how that row is drawn. The key is a stable
// presentation token chosen by the migration, not a component name, so a row
// added later with an unrecognised key still renders (generic phone icon)
// rather than crashing the page.
const DIRECTORY_ICONS = {
  apartment: { icon: ApartmentOutlinedIcon, color: 'primary' },
  police: { icon: LocalPoliceOutlinedIcon, color: 'info' },
  fire: { icon: LocalFireDepartmentOutlinedIcon, color: 'error' },
};

const FALLBACK_ICON = { icon: LocalPhoneOutlinedIcon, color: 'primary' };

/** Icon + palette colour for a directory row's icon_key. */
export function directoryIcon(iconKey) {
  return DIRECTORY_ICONS[iconKey] ?? FALLBACK_ICON;
}

/** Icon + palette colour for a staff contact (a person, not an organisation). */
export const STAFF_ICON = { icon: SupervisorAccountOutlinedIcon, color: 'primary' };

export const ROLE_CONTACTS = {
  // --- resident (item 2) ---
  // The managing office is the estate's own line; Police and Fire & Ambulance
  // are Singapore's national emergency numbers. No staff: a resident reaches
  // the office, not an individual manager, and GET /api/users/contacts refuses
  // the resident role for exactly that reason.
  resident: {
    helpSource: 'directory',
    helpCaption: 'Call your managing office',
    contactsTitle: 'Emergency contacts',
    contactsSubtitle: 'For urgent estate issues or emergencies.',
    directoryCategories: ['estate', 'emergency'],
  },

  // --- inspector (item 22) ---
  // Not a per-contractor list: `contractors` holds several maintenance
  // companies assigned per lift brand (Otis/Schindler/KONE in the seed), so no
  // one number is "the contractor". An inspector calls the estate line and the
  // office dispatches whoever services that defect; the estate managers handle
  // everything that is not a repair, and are who the sidebar card dials.
  inspector: {
    helpSource: 'staff',
    helpCaption: 'Call the estate manager',
    contactsTitle: 'Contacts',
    contactsSubtitle: 'Who to call while you are on site.',
    directoryCategories: ['estate'],
    staffLabel: 'Estate manager',
  },

  // --- manager (item 4) ---
  // A manager escalates to the estate admin, so the card dials an admin's own
  // number. The page also carries the estate line, which a manager needs for
  // the same dispatch reasons an inspector does.
  manager: {
    helpSource: 'staff',
    helpCaption: 'Call the estate admin',
    contactsTitle: 'Contacts',
    contactsSubtitle: 'Who to escalate to, and the estate line.',
    directoryCategories: ['estate'],
    staffLabel: 'Estate admin',
  },

  // --- contractor (item 16) ---
  // contractor: { ... },

  // --- admin (item 27) ---
  // Item 27 removed the admin card because it pointed at nobody; it is back
  // with a real destination, the estate manager who runs the estate day to day,
  // dialled from that manager's own profile row.
  //
  // Card only — no contactsTitle/staffLabel, so there is no contacts page for
  // this role. An admin's one contact is already the number on the card, and a
  // page repeating a single line would be redundant navigation. AdminLayout
  // therefore offers no Quick access link either.
  admin: {
    helpSource: 'staff',
    helpCaption: 'Call the estate manager',
  },
};

/** Values for a role; `{}` for a role nobody has filled in yet. */
export function getRoleContacts(role) {
  return ROLE_CONTACTS[role] ?? {};
}
