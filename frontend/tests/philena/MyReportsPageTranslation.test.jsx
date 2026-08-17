// MyReportsPage's wiring for on-demand translation (048) of the expanded
// card's closing remark / checklist remarks / history notes — the fetch call
// itself and that switching to a different expanded card starts fresh rather
// than showing the previous record's translation. ReportCard's own rendering
// of the translated text is covered by ReportCardTranslation.test.jsx; this
// file only pins what MyReportsPage does with the state around it.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseAuth = vi.fn();
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/context/SocketContext', () => ({
  useSocket: () => ({ socket: null, connected: true, joinRoom: vi.fn(), leaveRoom: vi.fn() }),
}));

vi.mock('../../src/services/api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
}));

import api from '../../src/services/api';
import MyReportsPage from '../../src/pages/MyReportsPage';

const REPORTS = [
  { id: 'insp-1', title: 'Lift button broken', category: 'Lift', location_block: '44A', status: 'Resolved', created_at: '2026-08-01T09:00:00Z' },
  { id: 'insp-2', title: 'Corridor light flickering', category: 'Electrical', location_block: '44A', status: 'Assigned', created_at: '2026-08-02T09:00:00Z' },
];

const DETAIL_BY_ID = {
  'insp-1': {
    id: 'insp-1',
    description: 'Button 3 does not respond',
    closing_remark: 'Replaced the button module.',
    checklist_results: [],
    history: [],
  },
  'insp-2': {
    id: 'insp-2',
    description: 'Flickers at night',
    closing_remark: null,
    checklist_results: [],
    history: [{ id: 'hist-1', action: 'Assigned', actor_name: 'Rachel Lim', created_at: '2026-08-02T10:00:00Z', note: 'Sent to electrician' }],
  },
};

function mockLoad() {
  api.get.mockImplementation((url) => {
    if (url === '/api/inspections/my') return Promise.resolve({ data: { data: REPORTS } });
    if (url === '/api/my-reports/history') return Promise.resolve({ data: { data: [] } });
    if (url.endsWith('/translation')) {
      return Promise.resolve({
        data: { closing_remark: '已更换按钮模块。', checklist_remarks: [], history_notes: [], was_translated: true },
      });
    }
    const id = url.split('/').pop();
    if (DETAIL_BY_ID[id]) return Promise.resolve({ data: DETAIL_BY_ID[id] });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  render(
    <MemoryRouter>
      <MyReportsPage />
    </MemoryRouter>
  );
}

describe('MyReportsPage — translation wiring', () => {
  beforeEach(() => {
    api.get.mockReset();
    mockLoad();
    mockUseAuth.mockReturnValue({
      profile: { role: 'resident', preferred_language: 'zh' },
    });
  });

  test('fetches the expanded record\'s translation in the profile\'s preferred language', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();

    const viewButtons = await screen.findAllByRole('button', { name: 'View details' });
    await user.click(viewButtons[0]); // insp-1
    await screen.findByText('Replaced the button module.');
    await user.click(screen.getByRole('button', { name: 'Translate to 中文 (Mandarin)' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/my-reports/insp-1/translation', {
        params: { lang: 'zh' },
      })
    );
    expect(await screen.findByText('已更换按钮模块。')).toBeInTheDocument();
  });

  test('collapsing and expanding a different card starts translation fresh', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();

    const viewButtons = await screen.findAllByRole('button', { name: 'View details' });
    await user.click(viewButtons[0]); // insp-1
    await screen.findByText('Replaced the button module.');
    await user.click(screen.getByRole('button', { name: 'Translate to 中文 (Mandarin)' }));
    await screen.findByText('已更换按钮模块。');

    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    await user.click(screen.getAllByRole('button', { name: 'View details' })[1]); // insp-2
    await screen.findByText('Sent to electrician');

    // insp-1's cached translation must not leak onto insp-2's card, and the
    // translate control must be ready to fetch again, not stuck mid-toggle.
    expect(screen.queryByText('已更换按钮模块。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Translate to/i })).toBeInTheDocument();
  });
});
