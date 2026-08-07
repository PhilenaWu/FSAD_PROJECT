// The contacts page is per-role: what is under test is that it reads the
// signed-in role's block from lib/roleContacts.js — residents get the estate
// and national lines, inspectors get the maintenance line and the manager, and
// a role nobody has filled in yet gets a message rather than an empty page.
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import EmergencyContactsPage from './EmergencyContactsPage';

function renderAs(role) {
  mockUseAuth.mockReturnValue({ profile: { role } });
  return render(<EmergencyContactsPage />);
}

describe('EmergencyContactsPage', () => {
  test('resident sees the managing office and the national lines', () => {
    renderAs('resident');
    expect(screen.getByText('Managing office')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('995')).toBeInTheDocument();
    expect(screen.queryByText('Estate maintenance')).not.toBeInTheDocument();
  });

  test('inspector sees the maintenance line and the estate manager only', () => {
    renderAs('inspector');
    expect(screen.getByText('Estate maintenance')).toBeInTheDocument();
    expect(screen.getByText('Estate manager')).toBeInTheDocument();
    expect(screen.queryByText('Managing office')).not.toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  test('numbers are dialable tel: links', () => {
    renderAs('resident');
    expect(screen.getByText('6500 0300').closest('a')).toHaveAttribute('href', 'tel:65000300');
  });

  test('a role with no contacts configured says so', () => {
    renderAs('manager');
    expect(screen.getByText(/No contacts have been listed/i)).toBeInTheDocument();
  });
});
