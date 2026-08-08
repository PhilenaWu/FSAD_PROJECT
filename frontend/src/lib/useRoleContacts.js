// Resolves the signed-in role's help/contacts block: the wording from
// roleContacts.js, every phone number from the database.
//
// Two sources, because the numbers are two different kinds of thing:
//   - GET /api/contacts       contact_directory (039) — the managing office and
//                             the national lines. Organisations, not accounts.
//   - GET /api/users/contacts users.phone (038) — a named member of staff's own
//                             number. The endpoint decides which role comes back
//                             from the verified token (manager -> admins,
//                             admin/inspector -> managers), so there is nothing
//                             to pass in and no way to ask for another role.
//
// Both the sidebar help card and /emergency-contacts call this, so a role's
// number can never disagree between the two — they are the same fetch.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { listDirectory } from '../services/contactService';
import { listContacts } from '../services/userService';
import { getRoleContacts, directoryIcon, STAFF_ICON } from './roleContacts';

/**
 * @returns {{
 *   helpPhone: string|undefined, helpCaption: string|undefined,
 *   contactsTitle: string|undefined, contactsSubtitle: string|undefined,
 *   contacts: {label: string, description: string, number: string,
 *              icon: React.ElementType, color: string}[],
 *   loading: boolean
 * }}
 */
export function useRoleContacts() {
  const { profile } = useAuth();
  const role = profile?.role;
  const {
    helpSource,
    helpCaption,
    contactsTitle,
    contactsSubtitle,
    directoryCategories,
    staffLabel,
  } = getRoleContacts(role);

  // What this role actually needs, so we never fire a request whose result
  // nothing renders — and never one the caller's role would be refused for
  // (/api/users/contacts is staff-only, so a resident must not reach it).
  const needsDirectory = helpSource === 'directory' || Boolean(directoryCategories?.length);
  const needsStaff = helpSource === 'staff' || Boolean(staffLabel);

  // null = not fetched yet or failed; an array = resolved (possibly empty).
  const [directory, setDirectory] = useState(null);
  const [staff, setStaff] = useState(null);

  useEffect(() => {
    if (!needsDirectory) return undefined;
    let active = true;
    listDirectory()
      .then((res) => {
        if (active) setDirectory(res.data);
      })
      .catch(() => {
        // Leave it null — the card falls back to "Contact support" and the page
        // says nothing is listed, rather than rendering a half-empty list.
      });
    return () => {
      active = false;
    };
  }, [needsDirectory]);

  useEffect(() => {
    if (!needsStaff) return undefined;
    let active = true;
    listContacts()
      .then((res) => {
        if (active) setStaff(res.data);
      })
      .catch(() => {
        // Same as above.
      });
    return () => {
      active = false;
    };
  }, [needsStaff]);

  // A contact with no number is not a contact: users.phone is nullable, so a
  // manager who has never published one would otherwise render a row whose
  // tel: link goes nowhere. The page's empty state covers "nobody has one yet".
  const directoryRows = (directory ?? [])
    .filter((c) => directoryCategories?.includes(c.category) && c.phone)
    .map((c) => ({
      label: c.label,
      description: c.description,
      number: c.phone,
      ...directoryIcon(c.icon_key),
    }));

  // Item 28: the managers as people — named, with the number from their own
  // profile row, so the page follows whoever holds the role.
  const staffRows = !staffLabel
    ? []
    : (staff ?? [])
        .filter((c) => c.phone)
        .map((c) => ({
          label: c.full_name,
          description: `${staffLabel} · ${c.email}`,
          number: c.phone,
          ...STAFF_ICON,
        }));

  // The sidebar card's single number. For 'directory' that is the one row
  // flagged is_help_line; for 'staff', the first counterpart who published one.
  let helpPhone;
  if (helpSource === 'directory') {
    helpPhone = directory?.find((c) => c.is_help_line)?.phone;
  } else if (helpSource === 'staff') {
    helpPhone = staff?.find((c) => c.phone)?.phone;
  }

  return {
    helpPhone,
    helpCaption,
    contactsTitle,
    contactsSubtitle,
    contacts: [...directoryRows, ...staffRows],
    // Still waiting on something this role needs. Keeps the contacts page from
    // flashing "no contacts listed" before the first response lands.
    loading: (needsDirectory && directory === null) || (needsStaff && staff === null),
  };
}
