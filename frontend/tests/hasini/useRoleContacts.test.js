// Tests for the hook behind both "who do I call?" surfaces (lib/useRoleContacts.js).
//
// EmergencyContactsPage.test.jsx covers the `contacts` list this hook returns.
// What is tested here is the half that page never reads: `helpPhone`, the single
// number on the sidebar help card in every layout. Its two selection rules —
// the directory row flagged is_help_line, or the first staff member who has
// published a number — are what decides whether a card dials someone real or
// falls back to a dead "Contact support" button.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('../../../frontend/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockListDirectory = vi.fn();
vi.mock('../../../frontend/src/services/contactService', () => ({
  listDirectory: () => mockListDirectory(),
}));

const mockListContacts = vi.fn();
vi.mock('../../../frontend/src/services/userService', () => ({
  listContacts: () => mockListContacts(),
}));

import { useRoleContacts } from '../../../frontend/src/lib/useRoleContacts';

// migration 039 seeds exactly one is_help_line row — the managing office. The
// national lines are in the same response and must not win the card.
const DIRECTORY = [
  { id: 'cd-2', label: 'Police', phone: '999', category: 'emergency', is_help_line: false },
  {
    id: 'cd-1',
    label: 'Managing office',
    phone: '6500 0300',
    category: 'estate',
    is_help_line: true,
  },
];

// users.phone is nullable, so the first row is not necessarily the reachable one.
const MANAGERS = [
  { id: 'mgr-2', full_name: 'Zoe Ng', email: 'zoe.ng@emservices.sg', phone: null },
  { id: 'mgr-1', full_name: 'Rachel Lim', email: 'rachel.lim@emservices.sg', phone: '6500 0321' },
];

const renderFor = (role) => {
  mockUseAuth.mockReturnValue({ profile: { role } });
  return renderHook(() => useRoleContacts());
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListDirectory.mockResolvedValue({ data: DIRECTORY });
  mockListContacts.mockResolvedValue({ data: MANAGERS });
});

describe('useRoleContacts — helpPhone', () => {
  test("a resident's card dials the is_help_line row, not whichever came first", async () => {
    const { result } = renderFor('resident');

    await waitFor(() => expect(result.current.helpPhone).toBe('6500 0300'));
    expect(result.current.helpCaption).toBe('Call your managing office');
  });

  test('a staff card skips a colleague who has published no number', async () => {
    // Zoe is first in the response but has no phone; the card must reach Rachel
    // rather than render a tel: link to nothing.
    const { result } = renderFor('inspector');

    await waitFor(() => expect(result.current.helpPhone).toBe('6500 0321'));
  });

  test('an admin card dials a manager (item 28 wiring, admin -> managers)', async () => {
    const { result } = renderFor('admin');

    await waitFor(() => expect(result.current.helpPhone).toBe('6500 0321'));
    expect(result.current.helpCaption).toBe('Call the estate manager');
    expect(mockListContacts).toHaveBeenCalled();
  });

  test('no staff has a number yet — the card falls back rather than showing a blank', async () => {
    mockListContacts.mockResolvedValue({ data: [{ id: 'm', full_name: 'Zoe Ng', phone: null }] });
    const { result } = renderFor('manager');

    await waitFor(() => expect(result.current.loading).toBe(false));
    // undefined is what AppShell reads as "render the disabled support button".
    expect(result.current.helpPhone).toBeUndefined();
  });

  test('a failed fetch leaves the card fallen back instead of throwing', async () => {
    mockListDirectory.mockRejectedValue(new Error('network'));
    const { result } = renderFor('resident');

    await waitFor(() => expect(mockListDirectory).toHaveBeenCalled());
    expect(result.current.helpPhone).toBeUndefined();
    expect(result.current.contacts).toEqual([]);
  });
});

describe('useRoleContacts — what each role is allowed to ask for', () => {
  test('a resident never calls the staff endpoint, which would refuse them 403', async () => {
    const { result } = renderFor('resident');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockListDirectory).toHaveBeenCalled();
    expect(mockListContacts).not.toHaveBeenCalled();
  });

  test('a role with no contacts block fires no requests at all', async () => {
    // Every real role has a block now — the contractor gained one in item 16 —
    // so an unmapped value stands in for the empty-block path the hook still
    // has to survive.
    const { result } = renderFor('auditor');

    // Nothing to wait for: with no source needed, loading is false on first render.
    expect(result.current.loading).toBe(false);
    expect(mockListDirectory).not.toHaveBeenCalled();
    expect(mockListContacts).not.toHaveBeenCalled();
  });
});

describe('useRoleContacts — loading', () => {
  test('starts loading, so the page does not flash "no contacts" before the data lands', async () => {
    const { result } = renderFor('admin');

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Both sources an admin needs have resolved by the time loading clears.
    expect(result.current.contacts.length).toBeGreaterThan(0);
  });
});
