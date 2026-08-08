// The contacts page is per-role, and every number on it comes from the API —
// nothing is hardcoded in the frontend any more. What is under test is that
// each role gets the right block: residents the estate and national lines,
// inspectors the estate line plus the managers by name, admins the managers
// (item 28), and a role nobody has filled in yet a message rather than an
// empty page.
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';

const mockUseAuth = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockListDirectory = vi.fn();
vi.mock('../../services/contactService', () => ({
  listDirectory: () => mockListDirectory(),
}));

const mockListContacts = vi.fn();
vi.mock('../../services/userService', () => ({
  listContacts: () => mockListContacts(),
}));

import EmergencyContactsPage from '../../pages/EmergencyContactsPage';

// Mirrors what migration 039 seeds into contact_directory.
const DIRECTORY = [
  {
    id: 'cd-1',
    label: 'Managing office',
    description: 'Estate maintenance, lift faults, general enquiries',
    phone: '6500 0300',
    category: 'estate',
    icon_key: 'apartment',
    is_help_line: true,
  },
  {
    id: 'cd-2',
    label: 'Police',
    description: 'National emergency line',
    phone: '999',
    category: 'emergency',
    icon_key: 'police',
    is_help_line: false,
  },
  {
    id: 'cd-3',
    label: 'Fire & Ambulance',
    description: 'National emergency line',
    phone: '995',
    category: 'emergency',
    icon_key: 'fire',
    is_help_line: false,
  },
];

// What GET /api/users/contacts returns to an admin or inspector: the managers,
// including one who has never published a number (users.phone is nullable).
const MANAGERS = [
  {
    id: 'mgr-1',
    full_name: 'Rachel Lim',
    email: 'rachel.lim.manager@emservices.sg',
    phone: '6500 0321',
  },
  { id: 'mgr-2', full_name: 'Zoe Ng', email: 'zoe.ng.manager@emservices.sg', phone: null },
];

function renderAs(role) {
  mockUseAuth.mockReturnValue({ profile: { role } });
  return render(<EmergencyContactsPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListDirectory.mockResolvedValue({ data: DIRECTORY });
  mockListContacts.mockResolvedValue({ data: MANAGERS });
});

describe('EmergencyContactsPage', () => {
  test('resident sees the managing office and the national lines', async () => {
    renderAs('resident');
    expect(await screen.findByText('Managing office')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('995')).toBeInTheDocument();
  });

  test('a resident never asks for staff numbers — that endpoint refuses them', async () => {
    renderAs('resident');
    await screen.findByText('Managing office');
    expect(mockListContacts).not.toHaveBeenCalled();
  });

  test('inspector sees the estate line and the managers, not the emergency lines', async () => {
    renderAs('inspector');
    expect(await screen.findByText('Managing office')).toBeInTheDocument();
    expect(screen.getByText('Rachel Lim')).toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  test('inspector sees managers by name, with the number from their own profile row', async () => {
    renderAs('inspector');
    expect(await screen.findByText('Rachel Lim')).toBeInTheDocument();
    expect(screen.getByText('6500 0321')).toBeInTheDocument();
    expect(screen.getByText(/rachel\.lim\.manager@emservices\.sg/)).toBeInTheDocument();
  });

  test('a manager who has published no number is left off rather than shown unreachable', async () => {
    renderAs('inspector');
    await screen.findByText('Rachel Lim');
    expect(screen.queryByText('Zoe Ng')).not.toBeInTheDocument();
  });

  // Item 28: an admin gets the same block an inspector does — the managers by
  // name (GET /api/users/contacts maps admin -> managers) and the estate line,
  // not the national emergency numbers.
  test('admin sees the managers and the estate line', async () => {
    renderAs('admin');
    expect(await screen.findByText('Rachel Lim')).toBeInTheDocument();
    expect(screen.getByText('6500 0321')).toBeInTheDocument();
    expect(screen.getByText('Managing office')).toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  test('numbers are dialable tel: links', async () => {
    renderAs('resident');
    const office = await screen.findByText('6500 0300');
    expect(office.closest('a')).toHaveAttribute('href', 'tel:65000300');
  });

  test('a role with no contacts configured says so', async () => {
    renderAs('contractor');
    expect(await screen.findByText(/No contacts have been listed/i)).toBeInTheDocument();
  });
});
