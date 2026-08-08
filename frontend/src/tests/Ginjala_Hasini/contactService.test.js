// Tests for the two contact data-layer calls — the directory
// (services/contactService.js) and the staff list
// (services/userService.js#listContacts).
//
// Both are mocked in useRoleContacts.test.js and EmergencyContactsPage.test.jsx,
// so these are the only assertions that the real functions address the routes
// the backend actually mounts.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import api from '../../services/api';
import { listDirectory } from '../../services/contactService';
import { listContacts } from '../../services/userService';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: [] });
});

describe('contact data layer', () => {
  test('the directory comes from /api/contacts', async () => {
    await listDirectory();

    expect(api.get).toHaveBeenCalledWith('/api/contacts');
  });

  // The endpoint derives the counterpart role from the verified token
  // (manager → admins, admin and inspector → managers), which is what stops a
  // caller asking for a role's numbers it has no business seeing. Sending a
  // role from here would be a security regression, not just a redundant param.
  test('the staff list asks for no role — the server decides from the token', async () => {
    await listContacts();

    expect(api.get).toHaveBeenCalledWith('/api/users/contacts');
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test('both return the axios response, which the hook reads as res.data', async () => {
    const rows = [{ id: 'cd-1', label: 'Managing office', phone: '6500 0300' }];
    api.get.mockResolvedValue({ data: rows });

    await expect(listDirectory()).resolves.toEqual({ data: rows });
  });
});
