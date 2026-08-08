// UC-010 contractor portal. The whole job lives on one page: acknowledge a
// defect, work it, hold it when you cannot, resume it, then sign it off. What
// is under test is the shape of that flow — which affordances are offered for a
// given record, what each action actually sends, and the two rules that are
// easy to get wrong: a hold pauses the deadline (so a held defect is not
// overdue), and "Submit work done" is refused until every item is ticked and
// the pad is signed.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseAuth = vi.fn();
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

vi.mock('../../src/services/contractorService', () => ({
  getAssigned: vi.fn(),
  acknowledge: vi.fn(),
  rectify: vi.fn(),
  hold: vi.fn(),
  resume: vi.fn(),
}));

// The real pad draws on a canvas jsdom does not implement. The stub keeps the
// ref contract the page depends on — isEmpty()/clear()/toBlob() — and exposes a
// button so a test can put ink on it.
vi.mock('../../src/components/SignaturePad', async () => {
  const { createElement, forwardRef, useImperativeHandle, useState } = await import('react');
  const MockPad = forwardRef(function MockSignaturePad(_props, ref) {
    const [hasInk, setHasInk] = useState(false);
    useImperativeHandle(
      ref,
      () => ({
        isEmpty: () => !hasInk,
        clear: () => setHasInk(false),
        toBlob: async () => new Blob(['signature'], { type: 'image/png' }),
      }),
      [hasInk]
    );
    return createElement(
      'button',
      { type: 'button', onClick: () => setHasInk(true) },
      'SIGN HERE'
    );
  });
  return { default: MockPad };
});

import { getAssigned, acknowledge, rectify, hold, resume } from '../../src/services/contractorService';
import ContractorInboxPage from '../../src/pages/ContractorInboxPage';

// Newest first, so this is also the order the default sort puts them in.
const NEW_JOB = {
  id: 'd-1',
  title: 'Blk 44A — Oil leak near lift',
  status: 'Assigned',
  location_block: '44A',
  location_unit: '12-34',
  description: 'Oil pooling under the lift car.',
  target_deadline: '2026-08-14T00:00:00.000Z',
  days_remaining: 5,
  created_at: '2026-08-08T02:00:00.000Z',
  acknowledged_at: null,
  hold_reason: null,
  checklist_results: [
    { id: 'c-1', item_text: 'Replace door roller', severity: 'Major', remark: 'Sticking badly', rectified: false },
    { id: 'c-2', item_text: 'Clean oil spill', severity: null, remark: null, rectified: false },
  ],
};

// Held, and long past its deadline — the case that proves a hold pauses the
// clock. No checklist items (a resident complaint handed to a contractor).
const HELD_JOB = {
  id: 'd-2',
  title: 'Blk 44B — Scratches on lift door',
  status: 'Assigned',
  location_block: '44B',
  location_unit: null,
  description: null,
  target_deadline: '2026-08-01T00:00:00.000Z',
  days_remaining: -8,
  created_at: '2026-08-07T02:00:00.000Z',
  acknowledged_at: '2026-08-07T03:00:00.000Z',
  hold_reason: 'Access denied by resident',
  checklist_results: [],
};

const SUBMITTED_JOB = {
  id: 'd-3',
  title: 'Blk 90C — Lift alarm faulty',
  status: 'Rectified',
  location_block: '90C',
  location_unit: null,
  description: null,
  target_deadline: '2026-08-20T00:00:00.000Z',
  days_remaining: 11,
  created_at: '2026-08-06T02:00:00.000Z',
  acknowledged_at: '2026-08-06T03:00:00.000Z',
  hold_reason: null,
  checklist_results: [],
};

const ALL = [NEW_JOB, HELD_JOB, SUBMITTED_JOB];

function renderInbox({ role = 'contractor', entry = '/jobs' } = {}) {
  mockUseAuth.mockReturnValue({ profile: { id: 'u-1', role } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/jobs" element={<ContractorInboxPage />} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// The selected defect's title is on screen twice — the list card and the work
// panel heading — so every lookup by title is a findAll, and the first match
// (the card) is the one to click.
const inboxLoaded = () => screen.findAllByText(NEW_JOB.title);

async function selectJob(user, title) {
  await user.click((await screen.findAllByText(title))[0]);
}

describe('ContractorInboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAssigned.mockResolvedValue(ALL);
    acknowledge.mockResolvedValue({});
    rectify.mockResolvedValue({});
    hold.mockResolvedValue({});
    resume.mockResolvedValue({});
  });

  test('lists the assigned defects and opens the first one', async () => {
    renderInbox();

    expect(await inboxLoaded()).not.toHaveLength(0);
    expect(screen.getByText('Blk 44B — Scratches on lift door')).toBeInTheDocument();
    // The first defect is selected, so its detail is on screen too.
    expect(screen.getByText('Oil pooling under the lift car.')).toBeInTheDocument();
    expect(screen.getByText('Replace door roller')).toBeInTheDocument();
  });

  test('a non-contractor is sent back to their dashboard', async () => {
    renderInbox({ role: 'manager' });
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
  });

  test('an empty inbox explains itself rather than showing a blank page', async () => {
    getAssigned.mockResolvedValue([]);
    renderInbox();

    expect(await screen.findByText('Nothing assigned yet')).toBeInTheDocument();
  });

  test('a failed load says so', async () => {
    getAssigned.mockRejectedValue(new Error('500'));
    renderInbox();

    expect(await screen.findByText('Could not load your assigned defects.')).toBeInTheDocument();
  });

  // Landing here from the bell's "Blk 44B — Scratches on lift door" must open
  // that job, not whatever would have been selected by default.
  test('a ?defect= deep link opens that job instead of the first', async () => {
    renderInbox({ entry: '/jobs?defect=d-2' });

    expect(await screen.findByText(/On hold — Access denied by resident/)).toBeInTheDocument();
  });

  test('a stale deep link falls back to the normal selection', async () => {
    renderInbox({ entry: '/jobs?defect=does-not-exist' });

    expect(await screen.findByText('Oil pooling under the lift car.')).toBeInTheDocument();
  });

  describe('counts and filters', () => {
    // d-1 untouched, d-2 acknowledged (and held), d-3 submitted — one each.
    test('the tiles split the inbox by what is left to do, and filter to it', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      expect(screen.getByText('Newly assigned').parentElement).toHaveTextContent('1');
      expect(screen.getByText('In progress').parentElement).toHaveTextContent('1');
      expect(screen.getByText('Completed').parentElement).toHaveTextContent('1');
      expect(screen.getByText('All (3)')).toBeInTheDocument();

      // A tile is a filter, not just a number.
      await user.click(screen.getByText('In progress'));
      await waitFor(() =>
        expect(screen.queryByText('Blk 90C — Lift alarm faulty')).not.toBeInTheDocument()
      );
      expect(screen.getByText('Blk 44B — Scratches on lift door')).toBeInTheDocument();
    });

    // A hold pauses the deadline, so d-2 is 8 days past its date and still not
    // overdue. Getting this wrong is what the manager scorecard's G11 rule
    // exists to prevent.
    test('a held defect is not counted as overdue', async () => {
      renderInbox();
      await inboxLoaded();

      expect(screen.getByText('Overdue (0)')).toBeInTheDocument();
      // ...and its card shows the hold, not a countdown.
      expect(screen.getByText('On hold')).toBeInTheDocument();
      expect(screen.queryByText('Overdue by 8d')).not.toBeInTheDocument();
    });

    test('an empty bucket offers a way back out', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      await user.click(screen.getByRole('tab', { name: /Overdue/ }));
      expect(await screen.findByText('No defects match')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(await inboxLoaded()).not.toHaveLength(0);
    });

    test('filtering by block narrows the list to that block', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      await user.click(screen.getByRole('button', { name: /Filter/ }));
      await user.click(await screen.findByRole('menuitem', { name: 'Block 44B' }));

      await waitFor(() =>
        expect(screen.queryByText('Blk 90C — Lift alarm faulty')).not.toBeInTheDocument()
      );
      expect(screen.getByText('Blk 44B — Scratches on lift door')).toBeInTheDocument();
    });
  });

  describe('acknowledge', () => {
    test('acknowledging a defect reports it and refetches the inbox', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      await user.click(screen.getByRole('button', { name: 'Acknowledge' }));

      await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('d-1'));
      expect(await screen.findByText('Defect acknowledged.')).toBeInTheDocument();
      // load(true) — a background refresh, so no spinner and a second fetch.
      await waitFor(() => expect(getAssigned).toHaveBeenCalledTimes(2));
    });

    test('a failed acknowledge shows the server reason', async () => {
      const user = userEvent.setup();
      acknowledge.mockRejectedValue({ response: { data: { message: 'Already acknowledged.' } } });
      renderInbox();
      await inboxLoaded();

      await user.click(screen.getByRole('button', { name: 'Acknowledge' }));

      expect(await screen.findByText('Already acknowledged.')).toBeInTheDocument();
    });

    // Nothing left to do on a submitted record: no acknowledge, no work form.
    test('a submitted defect offers no further action', async () => {
      const user = userEvent.setup();
      renderInbox();
      await selectJob(user, 'Blk 90C — Lift alarm faulty');

      expect(
        await screen.findByText(/awaiting the manager's joint endorsement/)
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
      expect(screen.queryByText('Complete the work')).not.toBeInTheDocument();
    });
  });

  describe('hold and resume', () => {
    test('a hold needs a reason before it can be placed', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      await user.click(screen.getByRole('button', { name: 'Unable to rectify' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('button', { name: 'Place on hold' })).toBeDisabled();

      // Whitespace is not a reason.
      await user.type(within(dialog).getByLabelText('Reason', { exact: false }), '   ');
      expect(within(dialog).getByRole('button', { name: 'Place on hold' })).toBeDisabled();
    });

    test('placing a hold sends the trimmed reason and pauses the deadline', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      await user.click(screen.getByRole('button', { name: 'Unable to rectify' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Reason', { exact: false }), '  Part on order  ');
      await user.click(within(dialog).getByRole('button', { name: 'Place on hold' }));

      await waitFor(() => expect(hold).toHaveBeenCalledWith('d-1', 'Part on order'));
      expect(
        await screen.findByText('Defect placed on hold — deadline paused.')
      ).toBeInTheDocument();
      // The dialog closes on success.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    test('cancelling the hold dialog holds nothing', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      await user.click(screen.getByRole('button', { name: 'Unable to rectify' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(hold).not.toHaveBeenCalled();
    });

    // Until resume existed a held defect was stuck on hold permanently, so the
    // way out is the thing worth asserting.
    test('a held defect shows its reason and can be resumed', async () => {
      const user = userEvent.setup();
      renderInbox();
      await selectJob(user, 'Blk 44B — Scratches on lift door');

      expect(await screen.findByText(/On hold — Access denied by resident/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Resume' }));

      await waitFor(() => expect(resume).toHaveBeenCalledWith('d-2'));
      expect(
        await screen.findByText('Work resumed — the deadline was extended by the time held.')
      ).toBeInTheDocument();
    });

    test('a held defect is still workable — the hold does not lock the form', async () => {
      const user = userEvent.setup();
      renderInbox();
      await selectJob(user, 'Blk 44B — Scratches on lift door');

      expect(await screen.findByText('Complete the work')).toBeInTheDocument();
    });

    test('a failed resume shows the server reason', async () => {
      const user = userEvent.setup();
      resume.mockRejectedValue({ response: { data: { message: 'Not on hold.' } } });
      renderInbox();
      await selectJob(user, 'Blk 44B — Scratches on lift door');

      await user.click(await screen.findByRole('button', { name: 'Resume' }));

      expect(await screen.findByText('Not on hold.')).toBeInTheDocument();
    });
  });

  describe('completing the work', () => {
    test('submit is refused until every item is ticked', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      expect(screen.getByRole('button', { name: /Submit work done/ })).toBeDisabled();
      expect(screen.getByText('0 of 2 items done')).toBeInTheDocument();
      expect(
        screen.getByText('Mark all items done to submit, or Save progress to finish later.')
      ).toBeInTheDocument();

      const ticks = screen.getAllByRole('checkbox', { name: 'Mark this item done' });
      await user.click(ticks[0]);
      expect(screen.getByText('1 of 2 items done')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Submit work done/ })).toBeDisabled();

      await user.click(ticks[1]);
      expect(screen.getByText('2 of 2 items done')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Submit work done/ })).toBeEnabled();
    });

    // The page's own guard, not the browser's: the form has no `required`
    // fields, so the submit reaches openFinalize() and is stopped there.
    test('submitting unsigned is refused, and nothing is sent', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      for (const tick of screen.getAllByRole('checkbox', { name: 'Mark this item done' })) {
        await user.click(tick);
      }
      await user.click(screen.getByRole('button', { name: /Submit work done/ }));

      expect(await screen.findByText('Please sign before submitting.')).toBeInTheDocument();
      expect(screen.queryByText('Submit work as complete?')).not.toBeInTheDocument();
      expect(rectify).not.toHaveBeenCalled();
    });

    test('signing then confirming finalizes with the items, remarks and signature', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      const remarks = screen.getAllByLabelText('Completion remark', { exact: false });
      await user.type(remarks[0], 'New roller fitted');
      for (const tick of screen.getAllByRole('checkbox', { name: 'Mark this item done' })) {
        await user.click(tick);
      }
      await user.click(screen.getByRole('button', { name: 'SIGN HERE' }));
      await user.click(screen.getByRole('button', { name: /Submit work done/ }));

      // The confirmation is a real step — it must be answered before anything
      // is sent, since the contractor cannot edit afterwards.
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Submit work as complete?')).toBeInTheDocument();
      expect(rectify).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: /Submit .* sign/ }));

      await waitFor(() => expect(rectify).toHaveBeenCalledTimes(1));
      const [id, formData] = rectify.mock.calls[0];
      expect(id).toBe('d-1');
      expect(JSON.parse(formData.get('items'))).toEqual([
        { checklist_result_id: 'c-1', completion_remark: 'New roller fitted', rectified: true },
        { checklist_result_id: 'c-2', completion_remark: '', rectified: true },
      ]);
      expect(formData.get('finalize')).toBe('true');
      expect(formData.get('signature')).toBeInstanceOf(Blob);
    });

    test('cancelling the confirmation submits nothing', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      for (const tick of screen.getAllByRole('checkbox', { name: 'Mark this item done' })) {
        await user.click(tick);
      }
      await user.click(screen.getByRole('button', { name: 'SIGN HERE' }));
      await user.click(screen.getByRole('button', { name: /Submit work done/ }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
      );

      expect(rectify).not.toHaveBeenCalled();
    });

    // Alt Flow B: finish some items now, the rest later. No signature, no
    // confirmation, and the record does not move on.
    test('Save progress sends what is done so far without a signature', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      const ticks = screen.getAllByRole('checkbox', { name: 'Mark this item done' });
      await user.click(ticks[0]);
      await user.click(screen.getByRole('button', { name: 'Save progress' }));

      await waitFor(() => expect(rectify).toHaveBeenCalledTimes(1));
      const formData = rectify.mock.calls[0][1];
      expect(formData.get('finalize')).toBe('false');
      expect(formData.get('signature')).toBeNull();
      expect(JSON.parse(formData.get('items'))).toEqual([
        { checklist_result_id: 'c-1', completion_remark: '', rectified: true },
        { checklist_result_id: 'c-2', completion_remark: '', rectified: false },
      ]);
      expect(
        await screen.findByText('Progress saved — finish the remaining items when ready.')
      ).toBeInTheDocument();
    });

    // A record with no checklist items has nothing to tick, so it is submittable
    // immediately and the overall remark is the only work field.
    test('a defect with no checklist items uses the overall remark', async () => {
      const user = userEvent.setup();
      renderInbox();
      await selectJob(user, 'Blk 44B — Scratches on lift door');
      await screen.findByText('Complete the work');

      expect(screen.queryByRole('button', { name: 'Save progress' })).not.toBeInTheDocument();
      await user.type(screen.getByLabelText('Work done', { exact: false }), '  Panel buffed out  ');
      await user.click(screen.getByRole('button', { name: 'SIGN HERE' }));
      await user.click(screen.getByRole('button', { name: /Submit work done/ }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: /Submit .* sign/ })
      );

      await waitFor(() => expect(rectify).toHaveBeenCalledTimes(1));
      const [id, formData] = rectify.mock.calls[0];
      expect(id).toBe('d-2');
      expect(formData.get('remark')).toBe('Panel buffed out');
      expect(JSON.parse(formData.get('items'))).toEqual([]);
    });

    test('a failed submit keeps the work on screen and says why', async () => {
      const user = userEvent.setup();
      rectify.mockRejectedValue({ response: { data: { message: 'Signature required.' } } });
      renderInbox();
      await inboxLoaded();

      for (const tick of screen.getAllByRole('checkbox', { name: 'Mark this item done' })) {
        await user.click(tick);
      }
      await user.click(screen.getByRole('button', { name: 'SIGN HERE' }));
      await user.click(screen.getByRole('button', { name: /Submit work done/ }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: /Submit .* sign/ })
      );

      expect(await screen.findByText('Signature required.')).toBeInTheDocument();
      expect(screen.getByText('Complete the work')).toBeInTheDocument();
    });

    // Switching defects must not carry one job's remarks onto another.
    test('switching defect resets the work panel', async () => {
      const user = userEvent.setup();
      renderInbox();
      await inboxLoaded();

      await user.type(
        screen.getAllByLabelText('Completion remark', { exact: false })[0],
        'Half-written note'
      );
      await selectJob(user, 'Blk 44B — Scratches on lift door');
      await screen.findByLabelText('Work done', { exact: false });
      await selectJob(user, 'Blk 44A — Oil leak near lift');

      expect(
        (await screen.findAllByLabelText('Completion remark', { exact: false }))[0]
      ).toHaveValue('');
    });
  });
});
