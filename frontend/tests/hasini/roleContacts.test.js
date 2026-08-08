// Tests for the per-role contacts recipe (lib/roleContacts.js) — the table the
// sidebar help card and /emergency-contacts both render from. The page itself
// is covered in EmergencyContactsPage.test.jsx; what's here is the table on its
// own, so a role losing a field is caught at the source rather than as a blank
// panel three components away.
import { describe, expect, test } from 'vitest';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import LocalPoliceOutlinedIcon from '@mui/icons-material/LocalPoliceOutlined';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import SupervisorAccountOutlinedIcon from '@mui/icons-material/SupervisorAccountOutlined';
import {
  ROLE_CONTACTS,
  getRoleContacts,
  directoryIcon,
  STAFF_ICON,
} from '../../../frontend/src/lib/roleContacts';

describe('getRoleContacts', () => {
  test('a resident draws on the directory only, never on staff numbers', () => {
    const { helpSource, directoryCategories, staffLabel } = getRoleContacts('resident');

    expect(helpSource).toBe('directory');
    expect(directoryCategories).toEqual(['estate', 'emergency']);
    // No staffLabel is what keeps the page from calling the staff-only
    // endpoint, which refuses a resident 403.
    expect(staffLabel).toBeUndefined();
  });

  test('an inspector gets the estate line and the managers, not the 999/995 lines', () => {
    const { directoryCategories, staffLabel } = getRoleContacts('inspector');

    expect(directoryCategories).toEqual(['estate']);
    expect(directoryCategories).not.toContain('emergency');
    expect(staffLabel).toBe('Estate manager');
  });

  test('a manager escalates to the admin', () => {
    const { helpSource, helpCaption, staffLabel } = getRoleContacts('manager');

    expect(helpSource).toBe('staff');
    expect(helpCaption).toBe('Call the estate admin');
    expect(staffLabel).toBe('Estate admin');
  });

  // Item 28. The admin block used to carry helpSource alone, so the contacts
  // page rendered its empty state for the role — the backend half
  // (GET /api/users/contacts maps admin -> managers) was built and unused.
  test('an admin has a full contacts block, not just a sidebar card', () => {
    const { helpSource, contactsTitle, directoryCategories, staffLabel } =
      getRoleContacts('admin');

    expect(helpSource).toBe('staff');
    expect(contactsTitle).toBe('Contacts');
    expect(staffLabel).toBe('Estate manager');
    expect(directoryCategories).toEqual(['estate']);
  });

  test('a role nobody has filled in yet resolves to an empty block, not undefined', () => {
    // The page destructures the result, so returning undefined would throw
    // rather than fall through to "no contacts listed".
    // All five real roles carry a block now (item 16 gave the contractor one),
    // so the fallback is exercised with values the map does not hold.
    expect(getRoleContacts('auditor')).toEqual({});
    expect(getRoleContacts(undefined)).toEqual({});
  });

  // Every role that names a staffLabel is asking the page to render staff rows,
  // which only /api/users/contacts can supply — and that route admits exactly
  // manager, admin, inspector and contractor. A role added here without a
  // matching entry on the route would render an empty page after a silent 403.
  test('only the roles the staff endpoint admits ask for staff rows', () => {
    const withStaff = Object.entries(ROLE_CONTACTS)
      .filter(([, block]) => block.staffLabel || block.helpSource === 'staff')
      .map(([role]) => role);

    // 'contractor' joined this list with item 16: the card dials the estate
    // manager who assigned the defect, and requireRole on GET
    // /api/users/contacts was widened to admit the role in the same change.
    expect(withStaff.sort()).toEqual(['admin', 'contractor', 'inspector', 'manager']);
  });
});

describe('directoryIcon', () => {
  test('each known icon_key maps to its own icon and palette colour', () => {
    expect(directoryIcon('apartment')).toEqual({
      icon: ApartmentOutlinedIcon,
      color: 'primary',
    });
    expect(directoryIcon('police')).toEqual({
      icon: LocalPoliceOutlinedIcon,
      color: 'info',
    });
    expect(directoryIcon('fire')).toEqual({
      icon: LocalFireDepartmentOutlinedIcon,
      color: 'error',
    });
  });

  // A row added to contact_directory by a later migration carries an icon_key
  // this file has never seen. It has to render as a plain phone rather than
  // take the page down with an undefined component.
  test('an unrecognised icon_key falls back to the generic phone icon', () => {
    const fallback = { icon: LocalPhoneOutlinedIcon, color: 'primary' };

    expect(directoryIcon('something-a-later-migration-adds')).toEqual(fallback);
    expect(directoryIcon(undefined)).toEqual(fallback);
  });
});

describe('STAFF_ICON', () => {
  test('staff are drawn as a person, distinct from the directory organisations', () => {
    expect(STAFF_ICON).toEqual({ icon: SupervisorAccountOutlinedIcon, color: 'primary' });
    expect(STAFF_ICON.icon).not.toBe(directoryIcon('apartment').icon);
  });
});
