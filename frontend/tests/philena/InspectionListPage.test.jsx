// UC-002 manager triage queue.
//
// What is under test is the sort behaviour: "All open" defaults to
// newest-submitted-first (a change from the old page-wide most-urgent-first
// default), every other tab keeps that older default, and the priority
// toggle — the manager's explicit override — cycles Critical→Low, then
// Low→Critical, then off, on whichever tab is active. Each of those is a
// `?sort=` value the query actually receives, not just a label on screen.
//
// The API, socket and auth are mocked; the page's own logic (which URL param
// it computes, what it renders) is real.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'manager', full_name: 'Mdm Tan' } }),
}));

vi.mock('../../src/context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

vi.mock('../../src/services/api', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../../src/services/analyticsService', () => ({
  getFilterOptions: vi.fn(async () => ({ blocks: ['44A', '44B'] })),
}));

import api from '../../src/services/api';
import InspectionListPage from '../../src/pages/InspectionListPage';

const ROW = {
  id: 'insp-1',
  title: 'Lift door not closing',
  location_block: '44A',
  category: 'Lift',
  priority: 'High',
  ai_priority_score: 72,
  status: 'Open',
};

function renderPage(initialEntry = '/inspections') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/inspections" element={<InspectionListPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// The `sort` param on the most recent GET /api/inspections call, or
// undefined if that call carried none.
function lastRequestedSort() {
  const call = api.get.mock.calls.at(-1);
  return call?.[1]?.params?.sort;
}

describe('InspectionListPage — sort', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: { data: [ROW], total: 1 } });
  });

  test('the "All open" tab defaults to sort=recent', async () => {
    renderPage('/inspections');

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(lastRequestedSort()).toBe('recent');
    expect(await screen.findByText(/most recently submitted first/i)).toBeInTheDocument();
  });

  test('other tabs send no explicit sort, keeping the priority-score default', async () => {
    renderPage('/inspections?tab=needs-action');

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(lastRequestedSort()).toBeUndefined();
    expect(await screen.findByText(/most urgent first/i)).toBeInTheDocument();
  });

  test('the priority toggle cycles Critical→Low, then Low→Critical, then off', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage('/inspections');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole('button', { name: /sort by priority/i }));
    await waitFor(() => expect(lastRequestedSort()).toBe('priority_critical_first'));
    expect(screen.getByText('Priority: Critical → Low')).toBeInTheDocument();

    await user.click(screen.getByText('Priority: Critical → Low'));
    await waitFor(() => expect(lastRequestedSort()).toBe('priority_low_first'));
    expect(screen.getByText('Priority: Low → Critical')).toBeInTheDocument();

    // The whole Chip is itself role="button" (that's the toggle click above);
    // the delete (x) icon is a separate, unlabelled SVG inside it, findable
    // only by MUI's own default testid.
    const chip = screen.getByText('Priority: Low → Critical').closest('.MuiChip-root');
    await user.click(within(chip).getByTestId('CancelIcon'));
    // Off means "defer to the tab's own default" — on "All open" that's
    // 'recent', not the absence of any sort at all.
    await waitFor(() => expect(lastRequestedSort()).toBe('recent'));
    expect(screen.getByRole('button', { name: /sort by priority/i })).toBeInTheDocument();
  });

  test('the priority toggle overrides a non-"All open" tab\'s default too', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage('/inspections?tab=in-progress');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(lastRequestedSort()).toBeUndefined();

    await user.click(await screen.findByRole('button', { name: /sort by priority/i }));

    await waitFor(() => expect(lastRequestedSort()).toBe('priority_critical_first'));
  });
});
