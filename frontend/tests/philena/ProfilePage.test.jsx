// Display-language setting (Profile page) — the reading preference behind
// the translate feature on InspectionDetailPage/InspectionListPage. Saves on
// change (there is no separate Save button for it), reverts on a failed save
// so the select never claims a change that didn't stick, and is offered to
// every role — not just residents — since staff read other people's free
// text too.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseAuth = vi.fn();
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/services/api', () => ({
  default: { patch: vi.fn() },
}));

// Not under test here — stubbed so a click into the (collapsed, unopened)
// password section can't reach the real Supabase client.
vi.mock('../../src/lib/auth', () => ({
  updatePassword: vi.fn(),
}));

import api from '../../src/services/api';
import ProfilePage from '../../src/pages/ProfilePage';

const RESIDENT = {
  user: { email: 'res@example.com' },
  profile: {
    role: 'resident',
    full_name: 'Marcus Tan',
    email: 'res@example.com',
    block_number: '44A',
    unit_number: '12-05',
    preferred_language: '',
  },
  profileLoading: false,
  reloadProfile: vi.fn(),
};

const MANAGER = {
  user: { email: 'mgr@example.com' },
  profile: { role: 'manager', full_name: 'Mdm Tan', preferred_language: '' },
  profileLoading: false,
  reloadProfile: vi.fn(),
};

// MUI's non-native Select renders a div (role="combobox"), not a real
// <select> — jest-dom's toHaveValue() doesn't apply, so tests read the
// displayed option text instead.
function languageSelect() {
  return screen.getByRole('combobox', { name: /Translate others' reports into/i });
}

describe('ProfilePage — display language', () => {
  beforeEach(() => {
    api.patch.mockReset();
    api.patch.mockResolvedValue({ data: {} });
    RESIDENT.reloadProfile.mockReset();
    MANAGER.reloadProfile.mockReset();
  });

  // MUI shows an empty Select's current value as a blank field rather than
  // the "don't translate" item's own label, so the unset state is checked by
  // which option the open dropdown marks selected, not by display text.
  test('offered to a resident, starting with no language chosen', async () => {
    const user = userEvent.setup({ delay: null });
    mockUseAuth.mockReturnValue(RESIDENT);
    render(<ProfilePage />);

    await user.click(languageSelect());

    expect(
      screen.getByRole('option', { name: "Don't translate — show as written" })
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: '中文 (Mandarin)' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  // The staff variant has no other editable field at all — this is the one
  // thing a manager/inspector/contractor can change on their own profile.
  test('also offered to a manager, not just residents', () => {
    mockUseAuth.mockReturnValue(MANAGER);
    render(<ProfilePage />);

    expect(languageSelect()).toBeInTheDocument();
  });

  test('picking a language saves immediately, with no separate Save button', async () => {
    const user = userEvent.setup({ delay: null });
    mockUseAuth.mockReturnValue(RESIDENT);
    render(<ProfilePage />);

    await user.click(languageSelect());
    await user.click(await screen.findByRole('option', { name: '中文 (Mandarin)' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/users/me', { preferred_language: 'zh' })
    );
    expect(RESIDENT.reloadProfile).toHaveBeenCalled();
  });

  test('a failed save reverts the select and says so', async () => {
    api.patch.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup({ delay: null });
    mockUseAuth.mockReturnValue(RESIDENT);
    render(<ProfilePage />);

    await user.click(languageSelect());
    await user.click(await screen.findByRole('option', { name: '中文 (Mandarin)' }));

    expect(
      await screen.findByText(/Could not update your display language/i)
    ).toBeInTheDocument();

    await user.click(languageSelect());
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: "Don't translate — show as written" })
      ).toHaveAttribute('aria-selected', 'true')
    );
    expect(screen.getByRole('option', { name: '中文 (Mandarin)' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });
});
