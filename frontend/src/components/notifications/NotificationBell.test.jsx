// The bell is a to-do list, not an archive: reading a notification takes it out
// of the list so the backlog shrinks as it is dealt with. What is under test is
// that behaviour — the row leaves, the read is persisted, and the badge drops.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

vi.mock('../../services/notificationService', () => ({
  list: vi.fn(),
  markRead: vi.fn(),
}));

import { list, markRead } from '../../services/notificationService';
import NotificationBell from './NotificationBell';

const ITEMS = [
  {
    id: 'n-1',
    message: 'Blk 44A — Oil leak near lift has been assigned to you.',
    urgency: 'Informational',
    event_type: 'defect_assigned',
    link: '/inspections/insp-1',
    created_at: '2026-08-08T02:00:00.000Z',
    read: false,
  },
  {
    id: 'n-2',
    message: 'Lift check completed.',
    urgency: 'Informational',
    event_type: null,
    link: null,
    created_at: '2026-08-08T01:00:00.000Z',
    read: false,
  },
];

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ data: { data: ITEMS, unread_count: ITEMS.length } });
    markRead.mockResolvedValue({});
  });

  test('loads only unread, so read messages do not come back on refresh', async () => {
    renderBell();
    await waitFor(() => expect(list).toHaveBeenCalledWith({ unread_only: true }));
  });

  // A row with no link stays put on screen, so this is where "the row leaves,
  // its neighbours don't" is actually observable.
  test('dismissing a notification removes just that row', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Lift check completed.')).toBeInTheDocument();

    await user.click(screen.getByText('Lift check completed.'));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith('n-2'));
    expect(screen.queryByText('Lift check completed.')).not.toBeInTheDocument();
    // The one left untouched stays.
    expect(screen.getByText(/Oil leak near lift/)).toBeInTheDocument();
  });

  // Opening one navigates away and closes the menu; the read still persists, so
  // it is gone from the list when the bell is next opened.
  test('opening a notification reads it on the way out', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByText(/Oil leak near lift/));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith('n-1'));

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.queryByText(/Oil leak near lift/)).not.toBeInTheDocument();
  });

  test('"Mark all read" empties the list', async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Oil leak near lift/)).not.toBeInTheDocument();
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });
});
