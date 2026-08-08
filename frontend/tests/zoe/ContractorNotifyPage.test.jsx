// UC-008 / UC-010 contractor composer. The point of this page is that a
// contractor can only ever reach staff: every audience combination maps to a
// staff-role scope, never a block, so a resident is unreachable by
// construction. That mapping — and the send/confirm/receipt cycle around it —
// is what is under test.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/services/notificationService', () => ({
  send: vi.fn(),
}));

import { send } from '../../src/services/notificationService';
import ContractorNotifyPage from '../../src/pages/ContractorNotifyPage';

const sendButton = () => screen.getByRole('button', { name: /^Send$/ });
// Once an outlined TextField has content its label is duplicated in the
// fieldset legend, and a <legend> labels its fieldset's controls too — so the
// same input matches twice. Both entries are that input; take the first.
const messageBox = () => screen.getAllByLabelText('Message', { exact: false })[0];

// Compose and push it through the confirm dialog. The dialog's own "Send" is
// the second button with that name once it is open, so it is looked up inside
// the dialog rather than by name alone.
async function sendMessage(user, text) {
  await user.type(messageBox(), text);
  await user.click(sendButton());
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Send' }));
}

describe('ContractorNotifyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({ data: { recipients_count: 3 } });
  });

  test('opens addressed to both audiences, and says so before anything is typed', () => {
    render(<ContractorNotifyPage />);
    expect(screen.getByText('Goes to the estate managers and inspectors')).toBeInTheDocument();
  });

  test('the banner follows the picker', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.click(screen.getByText('Inspectors'));
    expect(screen.getByText('Goes to the estate managers')).toBeInTheDocument();

    await user.click(screen.getByText('Managers'));
    await user.click(screen.getByText('Inspectors'));
    expect(screen.getByText('Goes to the inspectors')).toBeInTheDocument();
  });

  // Nobody selected has nobody to send to, so it is stopped here rather than at
  // the API.
  test('with no audience selected there is nothing to send to', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.type(messageBox(), 'Lift 2 is unsafe.');
    await user.click(screen.getByText('Managers'));
    await user.click(screen.getByText('Inspectors'));

    expect(screen.getByText('Pick who this goes to')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  test('an empty or whitespace-only message cannot be sent', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    expect(sendButton()).toBeDisabled();
    await user.type(messageBox(), '   ');
    expect(sendButton()).toBeDisabled();
  });

  test('a message over the 500-character limit is refused', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.click(messageBox());
    // Typing 501 characters one keystroke at a time is slow; paste instead.
    await user.paste('x'.repeat(501));

    expect(screen.getByText('501 / 500')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  test('exactly 500 characters is still allowed', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.click(messageBox());
    await user.paste('x'.repeat(500));

    expect(screen.getByText('500 / 500')).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });

  test('both audiences map to the managers_and_inspectors scope', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await sendMessage(user, '  Access refused at Blk 44A.  ');

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        message: 'Access refused at Blk 44A.', // trimmed
        scope: { type: 'managers_and_inspectors' },
        urgency: 'Informational',
      })
    );
  });

  test('managers only maps to the managers scope', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.click(screen.getByText('Inspectors')); // leaves managers
    await sendMessage(user, 'Part on order.');

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { type: 'managers' } })
      )
    );
  });

  // The one asymmetric mapping: "inspectors" is sent as `inspector_team`.
  test('inspectors only maps to the inspector_team scope', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.click(screen.getByText('Managers')); // leaves inspectors
    await sendMessage(user, 'Found a cracked door panel.');

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { type: 'inspector_team' } })
      )
    );
  });

  test('the chosen urgency is carried through, and named in the confirmation', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.type(messageBox(), 'Lift 2 is unsafe — stopped it.');
    await user.click(screen.getByRole('combobox', { name: /Urgency/ }));
    await user.click(await screen.findByRole('option', { name: /Critical/ }));
    await user.click(sendButton());

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'It goes to the estate managers and inspectors as a Critical message.'
      )
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ urgency: 'Critical' }))
    );
  });

  test('cancelling the confirmation sends nothing and keeps the message', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.type(messageBox(), 'Draft I changed my mind about.');
    await user.click(sendButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(send).not.toHaveBeenCalled();
    expect(messageBox()).toHaveValue('Draft I changed my mind about.');
  });

  // After a send the message box clears but the audience does not: a contractor
  // reporting to the inspectors once usually has more for the same people.
  test('a sent message clears the box but keeps the audience', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.click(screen.getByText('Managers')); // inspectors only
    await sendMessage(user, 'Cracked panel on lift 3.');

    expect(await screen.findByText('Sent to 3 recipients.')).toBeInTheDocument();
    expect(messageBox()).toHaveValue('');
    expect(screen.getByText('Goes to the inspectors')).toBeInTheDocument();
  });

  test('one recipient is reported in the singular', async () => {
    const user = userEvent.setup();
    send.mockResolvedValue({ data: { recipients_count: 1 } });
    render(<ContractorNotifyPage />);

    await sendMessage(user, 'Single reader.');

    expect(await screen.findByText('Sent to 1 recipient.')).toBeInTheDocument();
  });

  test('the urgency resets to Informational so the next message does not inherit Critical', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await user.type(messageBox(), 'Lift 2 is unsafe.');
    await user.click(screen.getByRole('combobox', { name: /Urgency/ }));
    await user.click(await screen.findByRole('option', { name: /Critical/ }));
    await user.click(sendButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send' }));

    await screen.findByText('Sent to 3 recipients.');
    // The confirm dialog aria-hides the page while it transitions out, so the
    // role query has to wait for it to finish leaving.
    expect(await screen.findByRole('combobox', { name: /Urgency/ })).toHaveTextContent(
      'Informational'
    );
  });

  test('a failed send shows the server message and keeps the text to retry', async () => {
    const user = userEvent.setup();
    send.mockRejectedValue({ response: { data: { message: 'Scope not allowed for your role.' } } });
    render(<ContractorNotifyPage />);

    await sendMessage(user, 'Access refused again.');

    expect(await screen.findByText('Scope not allowed for your role.')).toBeInTheDocument();
    expect(messageBox()).toHaveValue('Access refused again.');
  });

  test('a failure with no server message falls back to a usable one', async () => {
    const user = userEvent.setup();
    send.mockRejectedValue(new Error('network down'));
    render(<ContractorNotifyPage />);

    await sendMessage(user, 'Anything.');

    expect(await screen.findByText('Could not send — please try again.')).toBeInTheDocument();
  });

  test('the success alert can be dismissed', async () => {
    const user = userEvent.setup();
    render(<ContractorNotifyPage />);

    await sendMessage(user, 'Done here.');
    await screen.findByText('Sent to 3 recipients.');

    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Sent to 3 recipients.')).not.toBeInTheDocument();
  });
});
