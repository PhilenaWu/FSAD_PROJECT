// UC-008 read receipts. The badge is a live counter: it polls every 30 s, and
// what is under test is that it keeps counting — a failed tick must not wipe
// the count already on screen, and an unmounted badge must stop asking.
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/services/notificationService', () => ({
  getReceipts: vi.fn(),
}));

import { getReceipts } from '../../src/services/notificationService';
import ReadReceiptBadge from '../../src/components/notifications/ReadReceiptBadge';

// The poll fires on a timer, so every test drives the clock itself. `await act`
// flushes the promise the tick starts as well as the re-render it causes.
const POLL_MS = 30 * 1000;
const tick = async (ms = POLL_MS) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};
const settle = async () => {
  await act(async () => {});
};

describe('ReadReceiptBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getReceipts.mockResolvedValue({ data: { read_count: 2, total_recipients: 5 } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('says it is loading until the first count arrives', async () => {
    render(<ReadReceiptBadge notificationId="n-1" />);
    expect(screen.getByText('Loading receipts…')).toBeInTheDocument();

    await settle();
    expect(getReceipts).toHaveBeenCalledWith('n-1');
    expect(screen.getByText('2 of 5 read')).toBeInTheDocument();
  });

  // Nobody has read it yet is a real answer, not a missing one — the zero must
  // show rather than falling back to the loading text.
  test('shows a genuine zero rather than staying on "loading"', async () => {
    getReceipts.mockResolvedValue({ data: { read_count: 0, total_recipients: 4 } });
    render(<ReadReceiptBadge notificationId="n-1" />);
    await settle();
    expect(screen.getByText('0 of 4 read')).toBeInTheDocument();
  });

  test('with no notification id it asks for nothing', async () => {
    render(<ReadReceiptBadge notificationId={undefined} />);
    await settle();
    await tick();
    expect(getReceipts).not.toHaveBeenCalled();
    expect(screen.getByText('Loading receipts…')).toBeInTheDocument();
  });

  test('the count climbs as recipients read it', async () => {
    render(<ReadReceiptBadge notificationId="n-1" />);
    await settle();
    expect(screen.getByText('2 of 5 read')).toBeInTheDocument();

    getReceipts.mockResolvedValue({ data: { read_count: 5, total_recipients: 5 } });
    await tick();

    expect(getReceipts).toHaveBeenCalledTimes(2);
    expect(screen.getByText('5 of 5 read')).toBeInTheDocument();
  });

  // A dropped request is transient: the badge must hold the last known count
  // instead of blanking back to "Loading receipts…", and recover on the next tick.
  test('a failed tick keeps the last count, and the next one recovers', async () => {
    render(<ReadReceiptBadge notificationId="n-1" />);
    await settle();

    getReceipts.mockRejectedValueOnce(new Error('network'));
    await tick();
    expect(screen.getByText('2 of 5 read')).toBeInTheDocument();
    expect(screen.queryByText('Loading receipts…')).not.toBeInTheDocument();

    getReceipts.mockResolvedValue({ data: { read_count: 3, total_recipients: 5 } });
    await tick();
    expect(screen.getByText('3 of 5 read')).toBeInTheDocument();
  });

  test('switching notification refetches for the new one', async () => {
    const { rerender } = render(<ReadReceiptBadge notificationId="n-1" />);
    await settle();

    getReceipts.mockResolvedValue({ data: { read_count: 1, total_recipients: 9 } });
    rerender(<ReadReceiptBadge notificationId="n-2" />);
    await settle();

    expect(getReceipts).toHaveBeenLastCalledWith('n-2');
    expect(screen.getByText('1 of 9 read')).toBeInTheDocument();
  });

  test('an unmounted badge stops polling', async () => {
    const { unmount } = render(<ReadReceiptBadge notificationId="n-1" />);
    await settle();
    expect(getReceipts).toHaveBeenCalledTimes(1);

    unmount();
    await tick(POLL_MS * 3);

    expect(getReceipts).toHaveBeenCalledTimes(1);
  });
});
