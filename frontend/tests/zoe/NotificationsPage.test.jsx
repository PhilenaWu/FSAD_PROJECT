// UC-008 /notifications. One route, two pages: a contractor gets the contractor
// composer, everyone else the manager one. The split is the regression under
// test — the manager composer fetches manager-only endpoints on mount, which
// 403 for a contractor and painted the page as an error.
//
// Beyond that: the client-side guard that decides whether the confirm dialog
// opens at all, the scope the form actually builds, and the send history with
// its per-row read counts.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseAuth = vi.fn();
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/services/notificationService', () => ({
  send: vi.fn(),
  listSent: vi.fn(),
  getReceipts: vi.fn(),
}));

vi.mock('../../src/services/contractorService', () => ({
  listContractors: vi.fn(),
}));

import { send, listSent, getReceipts } from '../../src/services/notificationService';
import { listContractors } from '../../src/services/contractorService';
import NotificationsPage from '../../src/pages/NotificationsPage';

const HISTORY = [
  {
    id: 'n-1',
    status: 'Sent',
    urgency: 'Warning',
    scope: { type: 'blocks', blocks: ['44A', '44B'] },
    message: 'Lift 2 out of service this Friday.',
    sent_at: '2026-08-08T02:00:00.000Z',
    created_at: '2026-08-08T01:00:00.000Z',
    read_count: 2,
    total_recipients: 5,
  },
  {
    id: 'n-2',
    status: 'Scheduled',
    urgency: 'Informational',
    scope: { type: 'all_blocks' },
    message: 'Annual lift servicing next month.',
    send_time: '2026-09-01T01:00:00.000Z',
    sent_at: null,
    created_at: '2026-08-08T00:00:00.000Z',
    read_count: 0,
    total_recipients: 0,
  },
];

const CONTRACTORS = [
  { id: 'c-1', name: 'LiftCo Pte Ltd', user_id: 'u-lift' },
  // Onboarded without a login — messaging it would resolve to no recipient, so
  // it must not be offered.
  { id: 'c-2', name: 'No-Login Vendor', user_id: null },
];

function renderAs(role) {
  mockUseAuth.mockReturnValue({ profile: { id: 'u-1', role } });
  return render(<NotificationsPage />);
}

// An outlined TextField with content repeats its label in the fieldset legend,
// and a <legend> labels its fieldset's controls too, so the same input matches
// twice. Both entries are that input; take the first.
const messageBox = () => screen.getAllByLabelText('Message', { exact: false })[0];

// A history row, found by its message and scoped to its card — the composer
// above repeats scope wording like "All blocks" on its picker cards.
const historyRow = async (message) =>
  (await screen.findByText(message)).closest('.MuiPaper-root');
const sendButton = () => screen.getByRole('button', { name: 'Send notification' });

async function confirm(user) {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /^(Send|Schedule)$/ }));
}

describe('NotificationsPage role split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSent.mockResolvedValue({ data: { data: HISTORY } });
    listContractors.mockResolvedValue({ data: CONTRACTORS });
    send.mockResolvedValue({
      data: { notification_id: 'n-new', status: 'Sent', recipients_count: 4 },
    });
    getReceipts.mockResolvedValue({ data: { read_count: 0, total_recipients: 4 } });
  });

  test('a manager gets the composer', async () => {
    renderAs('manager');
    expect(screen.getByText('Send a notification')).toBeInTheDocument();
    await waitFor(() => expect(listSent).toHaveBeenCalled());
  });

  // The hole the split closes: rendering the manager composer for a contractor
  // ran manager-only fetches that 403.
  test('a contractor gets their own composer, and no manager-only fetch runs', async () => {
    renderAs('contractor');
    expect(screen.getByText('Message the office')).toBeInTheDocument();
    expect(screen.queryByText('Send a notification')).not.toBeInTheDocument();
    expect(listSent).not.toHaveBeenCalled();
    expect(listContractors).not.toHaveBeenCalled();
  });

  test('an inspector or admin reaching the route still gets the manager composer', () => {
    renderAs('inspector');
    expect(screen.getByText('Send a notification')).toBeInTheDocument();
  });

  test('no profile yet falls back to the manager composer rather than nothing', () => {
    mockUseAuth.mockReturnValue({ profile: null });
    render(<NotificationsPage />);
    expect(screen.getByText('Send a notification')).toBeInTheDocument();
  });
});

describe('NotificationsPage manager composer — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSent.mockResolvedValue({ data: { data: [] } });
    listContractors.mockResolvedValue({ data: CONTRACTORS });
    send.mockResolvedValue({
      data: { notification_id: 'n-new', status: 'Sent', recipients_count: 4 },
    });
  });

  test('an empty message never opens the confirmation', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.click(sendButton());

    expect(
      screen.getByText('Message is required and must be 500 characters or fewer.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  test('a whitespace-only message is treated as empty', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.type(messageBox(), '    ');
    await user.click(sendButton());

    expect(
      screen.getByText('Message is required and must be 500 characters or fewer.')
    ).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  test('the block scope needs at least one block', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.type(messageBox(), 'Water shut off tomorrow.');
    await user.click(sendButton());

    expect(screen.getByText('Enter at least one block number.')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  test('the contractor scope needs a contractor picked', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.click(screen.getByText('Specific contractor'));
    await user.type(messageBox(), 'Please attend Blk 44A.');
    await user.click(sendButton());

    expect(screen.getByText('Select a contractor.')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  test('fixing the problem clears the error and lets the send through', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.type(messageBox(), 'Water shut off tomorrow.');
    await user.click(sendButton());
    expect(screen.getByText('Enter at least one block number.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Block number(s)', { exact: false }), '44A');
    await user.click(sendButton());

    expect(screen.queryByText('Enter at least one block number.')).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('NotificationsPage manager composer — sending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSent.mockResolvedValue({ data: { data: [] } });
    listContractors.mockResolvedValue({ data: CONTRACTORS });
    send.mockResolvedValue({
      data: { notification_id: 'n-new', status: 'Sent', recipients_count: 4 },
    });
    getReceipts.mockResolvedValue({ data: { read_count: 1, total_recipients: 4 } });
  });

  test('a comma-separated block list becomes an array of trimmed blocks', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.type(screen.getByLabelText('Block number(s)', { exact: false }), ' 44A , 44B ,, 90C ');
    await user.type(messageBox(), '  Lift 2 out of service.  ');
    await user.click(sendButton());
    await confirm(user);

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        message: 'Lift 2 out of service.',
        scope: { type: 'blocks', blocks: ['44A', '44B', '90C'] },
        urgency: 'Informational',
        send_time: null,
      })
    );
  });

  test('only contractors with a linked login are offered', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.click(screen.getByText('Specific contractor'));
    // The picker is disabled until the list lands, so wait for the loaded
    // helper text rather than clicking into a disabled select.
    await screen.findByText('Only contractors with a login account can be messaged.');
    await user.click(screen.getByRole('combobox', { name: /Contractor/ }));

    expect(await screen.findByRole('option', { name: 'LiftCo Pte Ltd' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'No-Login Vendor' })).not.toBeInTheDocument();
  });

  test('the chosen contractor is named in the confirmation and sent as a user id', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.click(screen.getByText('Specific contractor'));
    await screen.findByText('Only contractors with a login account can be messaged.');
    await user.click(screen.getByRole('combobox', { name: /Contractor/ }));
    await user.click(await screen.findByRole('option', { name: 'LiftCo Pte Ltd' }));
    await user.type(messageBox(), 'Please attend Blk 44A.');
    await user.click(sendButton());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/contractor LiftCo Pte Ltd/)).toBeInTheDocument();

    await confirm(user);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { type: 'contractor', contractor_user_id: 'u-lift' },
        })
      )
    );
  });

  test('a failed contractor list says so instead of looking empty', async () => {
    const user = userEvent.setup();
    listContractors.mockRejectedValue(new Error('403'));
    renderAs('manager');

    await user.click(screen.getByText('Specific contractor'));

    expect(
      await screen.findByText('Could not load contractors — reload to try again.')
    ).toBeInTheDocument();
  });

  test('an immediate send reports the count and starts the live receipt badge', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.type(screen.getByLabelText('Block number(s)', { exact: false }), '44A');
    await user.type(messageBox(), 'Lift 2 out of service.');
    await user.click(sendButton());
    await confirm(user);

    expect(await screen.findByText('Sent to 4 recipients.')).toBeInTheDocument();
    expect(await screen.findByText('1 of 4 read')).toBeInTheDocument();
    expect(getReceipts).toHaveBeenCalledWith('n-new');
  });

  // A scheduled notification has no recipients resolved yet, so a receipt badge
  // there would be counting nothing.
  test('a scheduled send confirms the schedule and shows no receipts', async () => {
    const user = userEvent.setup();
    send.mockResolvedValue({ data: { notification_id: 'n-later', status: 'Scheduled' } });
    renderAs('manager');

    await user.type(screen.getByLabelText('Block number(s)', { exact: false }), '44A');
    await user.type(messageBox(), 'Annual servicing.');
    // datetime-local is not typeable in jsdom — set it the way the picker would.
    fireEvent.change(screen.getByLabelText('Schedule (optional)', { exact: false }), {
      target: { value: '2026-09-01T09:00' },
    });

    expect(screen.getByRole('button', { name: 'Schedule notification' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Schedule notification' }));
    await confirm(user);

    expect(
      await screen.findByText(
        'Scheduled — it will be sent within about a minute of the selected time.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/read$/)).not.toBeInTheDocument();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ send_time: new Date('2026-09-01T09:00').toISOString() })
    );
  });

  test('the message clears after a send and the history is reloaded', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await waitFor(() => expect(listSent).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText('Block number(s)', { exact: false }), '44A');
    await user.type(messageBox(), 'Lift 2 out of service.');
    await user.click(sendButton());
    await confirm(user);

    await waitFor(() => expect(listSent).toHaveBeenCalledTimes(2));
    expect(messageBox()).toHaveValue('');
  });

  test('a failed send shows the server message', async () => {
    const user = userEvent.setup();
    send.mockRejectedValue({ response: { data: { message: 'No recipients in those blocks.' } } });
    renderAs('manager');

    await user.type(screen.getByLabelText('Block number(s)', { exact: false }), '99Z');
    await user.type(messageBox(), 'Anyone there?');
    await user.click(sendButton());
    await confirm(user);

    expect(await screen.findByText('No recipients in those blocks.')).toBeInTheDocument();
  });

  test('Clear puts the form back to its starting state', async () => {
    const user = userEvent.setup();
    renderAs('manager');

    await user.click(screen.getByText('Specific contractor'));
    await user.type(messageBox(), 'Half-written draft.');
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(messageBox()).toHaveValue('');
    // Back to the block scope, so the block field is on screen again.
    expect(screen.getByLabelText('Block number(s)', { exact: false })).toBeInTheDocument();
  });
});

describe('NotificationsPage manager composer — send history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listContractors.mockResolvedValue({ data: CONTRACTORS });
    listSent.mockResolvedValue({ data: { data: HISTORY } });
  });

  test('each row shows its status, scope and read count', async () => {
    renderAs('manager');

    const row = within(await historyRow('Lift 2 out of service this Friday.'));
    expect(row.getByText('Block(s) 44A, 44B')).toBeInTheDocument();
    expect(row.getByText('2 of 5 recipients read')).toBeInTheDocument();
    expect(row.getByText('Sent')).toBeInTheDocument();
    expect(row.getByText('Warning')).toBeInTheDocument();
  });

  // Recipients are resolved at dispatch, so "0 of 0 read" on a scheduled row
  // would be a lie.
  test('a scheduled row shows its send time and no read count', async () => {
    renderAs('manager');

    const row = within(await historyRow('Annual lift servicing next month.'));
    expect(row.getByText('All blocks')).toBeInTheDocument();
    expect(row.getByText(/^for /)).toBeInTheDocument();
    expect(row.queryByText('0 of 0 recipients read')).not.toBeInTheDocument();
  });

  test('a single recipient is counted in the singular', async () => {
    listSent.mockResolvedValue({
      data: {
        data: [{ ...HISTORY[0], id: 'n-3', read_count: 1, total_recipients: 1 }],
      },
    });
    renderAs('manager');

    expect(await screen.findByText('1 of 1 recipient read')).toBeInTheDocument();
  });

  test('an unknown stored scope falls back to its type rather than breaking the row', async () => {
    listSent.mockResolvedValue({
      data: { data: [{ ...HISTORY[0], id: 'n-4', scope: { type: 'managers_and_inspectors' } }] },
    });
    renderAs('manager');

    expect(await screen.findByText('managers_and_inspectors')).toBeInTheDocument();
  });

  test('an empty history says so', async () => {
    listSent.mockResolvedValue({ data: { data: [] } });
    renderAs('manager');

    expect(
      await screen.findByText('Nothing sent yet — notifications you send will be listed here.')
    ).toBeInTheDocument();
  });

  test('a failed history load is an error, not an empty list', async () => {
    listSent.mockRejectedValue(new Error('500'));
    renderAs('manager');

    expect(
      await screen.findByText('Could not load your notification history.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Nothing sent yet — notifications you send will be listed here.')
    ).not.toBeInTheDocument();
  });
});
