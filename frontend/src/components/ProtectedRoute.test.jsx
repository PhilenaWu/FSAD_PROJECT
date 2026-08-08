// The gate decides who gets into the app at all. What is under test is that a
// refused account never renders the protected content — the regression being
// that "suspended" was explained from inside the app, so signing out from that
// screen left a session-less user in the resident portal.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import ProtectedRoute from './ProtectedRoute';

const SIGNED_IN = {
  user: { id: 'u-1' },
  profile: { id: 'u-1', role: 'resident' },
  loading: false,
  profileLoading: false,
  profileError: false,
  suspended: false,
  accountBlocked: null,
  logout: vi.fn(),
  reloadProfile: vi.fn(),
};

function renderGate(auth) {
  mockUseAuth.mockReturnValue({ ...SIGNED_IN, ...auth });
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>PORTAL</div>} />
        </Route>
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => mockUseAuth.mockReset());

  test('an admitted account gets the app', () => {
    renderGate({});
    expect(screen.getByText('PORTAL')).toBeInTheDocument();
  });

  test('no session goes to the login page', () => {
    renderGate({ user: null });
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  test('a suspended account is refused, and never renders the app', () => {
    renderGate({ suspended: true });
    expect(screen.getByText('Access revoked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to login' })).toBeInTheDocument();
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  test('an unapproved resident is told why, and never renders the app', () => {
    renderGate({ accountBlocked: 'pending' });
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  test('a rejected registration is refused too', () => {
    renderGate({ accountBlocked: 'rejected' });
    expect(screen.getByText('Request not approved')).toBeInTheDocument();
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  // The hole this change closes: signing out dropped the session but the gate
  // had already decided, so the app kept rendering with no role — which fell
  // through to the resident portal.
  test('losing the session mid-visit sends the user to login, not the portal', () => {
    const { rerender } = renderGate({ suspended: true });
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();

    mockUseAuth.mockReturnValue({ ...SIGNED_IN, user: null, suspended: false });
    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<div>PORTAL</div>} />
          </Route>
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('LOGIN')).toBeInTheDocument();
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  test('the app does not mount while we still do not know if they are admitted', () => {
    renderGate({ profileLoading: true });
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  // The Ahmad Faizal case: a suspended vendor whose profile row could not be
  // read answers 404, not ACCOUNT_SUSPENDED. That is not a refusal the app can
  // explain — and it must not become "resident", which is what RoleLayout's old
  // fallback did, putting a contractor in the resident portal.
  test('an unreadable profile is an error, never the resident portal', () => {
    renderGate({ profileError: true, profile: null });
    expect(screen.getByText('Could not load your account')).toBeInTheDocument();
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  test('a missing profile without an explicit error is refused too', () => {
    renderGate({ profile: null });
    expect(screen.getByText('Could not load your account')).toBeInTheDocument();
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument();
  });

  // Refusals we CAN explain keep their own screen — the error screen must not
  // swallow them, since profileError is true for those too.
  test('a suspended account still gets the revoked screen, not the error screen', () => {
    renderGate({ suspended: true, profileError: true, profile: null });
    expect(screen.getByText('Access revoked')).toBeInTheDocument();
    expect(screen.queryByText('Could not load your account')).not.toBeInTheDocument();
  });
});
