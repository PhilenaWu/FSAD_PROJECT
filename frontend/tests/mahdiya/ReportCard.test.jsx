// ReportCard is the summary + expandable detail for one report on the UC-003
// "My reports" page, including the resident report-edit feature (editable
// within 30 minutes of filing). It's a controlled component — all state is
// owned by the parent (MyReportsPage) and passed in as props — so these tests
// drive it purely through props/callbacks, with no service mocking needed.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import ReportCard from '../../src/components/inspections/ReportCard';

const REPORT = {
  id: 'insp-1',
  title: 'Lift button broken at Level 3',
  category: 'Lift',
  location_block: '44A',
  location_unit: '12-05',
  status: 'Open',
  created_at: '2026-08-08T09:15:00Z',
};

const EDIT_DRAFT = {
  title: REPORT.title,
  description: 'Button 3 does not respond',
  category: 'Lift',
  location_block: '44A',
  location_unit: '12-05',
};

function baseProps(overrides = {}) {
  return {
    report: REPORT,
    expanded: false,
    detail: null,
    detailLoading: false,
    detailError: false,
    onToggle: vi.fn(),
    onRetryDetail: vi.fn(),
    editable: false,
    editing: false,
    editDraft: EDIT_DRAFT,
    editSaving: false,
    editError: null,
    onEditToggle: vi.fn(),
    onEditChange: vi.fn(),
    onEditSave: vi.fn(),
    onEditCancel: vi.fn(),
    ...overrides,
  };
}

describe('ReportCard — summary', () => {
  test('shows the title, category, block, unit, and status', () => {
    render(<ReportCard {...baseProps()} />);

    expect(screen.getByText('Lift button broken at Level 3')).toBeInTheDocument();
    expect(screen.getByText(/Lift · Block 44A #12-05/)).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  test('toggling the details button calls onToggle and reflects expanded state', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<ReportCard {...baseProps({ onToggle })} />);

    expect(screen.getByRole('button', { name: 'View details' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View details' }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<ReportCard {...baseProps({ onToggle, expanded: true })} />);
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeInTheDocument();
  });
});

describe('ReportCard — expanded detail', () => {
  test('shows a spinner while the detail is loading', () => {
    render(<ReportCard {...baseProps({ expanded: true, detailLoading: true })} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  test('shows a retry alert on error, and Retry calls onRetryDetail', async () => {
    const user = userEvent.setup();
    const onRetryDetail = vi.fn();
    render(<ReportCard {...baseProps({ expanded: true, detailError: true, onRetryDetail })} />);

    expect(screen.getByText(/Could not load the details/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryDetail).toHaveBeenCalledTimes(1);
  });

  test('renders description, checklist (grouped by section), and progress history', () => {
    const detail = {
      description: 'Button 3 does not respond',
      history: [{ id: 'h-1', action: 'Assigned', actor_name: 'Rachel Lim', created_at: '2026-08-08T10:00:00Z', note: null }],
      checklist_results: [
        { id: 'c-1', section: 'A — Motor Room', item_text: 'Cleanliness', result: 'Pass', severity: null, remark: null },
        { id: 'c-2', section: 'A — Motor Room', item_text: 'Bearings', result: 'Defect', severity: 'Major', remark: 'Grinding noise' },
      ],
    };
    render(<ReportCard {...baseProps({ expanded: true, detail })} />);

    expect(screen.getByText('Button 3 does not respond')).toBeInTheDocument();
    expect(screen.getByText('A — Motor Room')).toBeInTheDocument();
    expect(screen.getByText(/Bearings — Grinding noise/)).toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
    expect(screen.getByText(/Rachel Lim/)).toBeInTheDocument();
  });

  test('shows the "no updates yet" placeholder when history is empty', () => {
    const detail = { description: null, history: [], checklist_results: [] };
    render(<ReportCard {...baseProps({ expanded: true, detail })} />);
    expect(screen.getByText(/waiting to be reviewed/)).toBeInTheDocument();
  });
});

describe('ReportCard — edit gating (30-minute window)', () => {
  const detail = { description: 'Button 3 does not respond', history: [], checklist_results: [] };

  test('hides the Edit report button when not editable', () => {
    render(<ReportCard {...baseProps({ expanded: true, detail, editable: false })} />);
    expect(screen.queryByRole('button', { name: /edit report/i })).not.toBeInTheDocument();
  });

  test('shows Edit report when editable, and clicking it calls onEditToggle', async () => {
    const user = userEvent.setup();
    const onEditToggle = vi.fn();
    render(<ReportCard {...baseProps({ expanded: true, detail, editable: true, onEditToggle })} />);

    const btn = screen.getByRole('button', { name: /edit report/i });
    await user.click(btn);
    expect(onEditToggle).toHaveBeenCalledTimes(1);
  });
});

describe('ReportCard — edit form', () => {
  test('prefills the form fields from editDraft', () => {
    render(<ReportCard {...baseProps({ expanded: true, detail: {}, editing: true })} />);

    expect(screen.getByLabelText('Title', { exact: false })).toHaveValue(EDIT_DRAFT.title);
    expect(screen.getByLabelText('Description', { exact: false })).toHaveValue(EDIT_DRAFT.description);
    expect(screen.getByLabelText('Unit (optional)')).toHaveValue(EDIT_DRAFT.location_unit);
  });

  test('typing in the title field reports the change via onEditChange', async () => {
    const user = userEvent.setup();
    const onEditChange = vi.fn();
    render(<ReportCard {...baseProps({ expanded: true, detail: {}, editing: true, onEditChange })} />);

    await user.type(screen.getByLabelText('Title', { exact: false }), '!');
    expect(onEditChange).toHaveBeenCalledWith({ ...EDIT_DRAFT, title: `${EDIT_DRAFT.title}!` });
  });

  test('Save changes calls onEditSave, and shows "Saving…" while busy', () => {
    const onEditSave = vi.fn();
    const { rerender } = render(
      <ReportCard {...baseProps({ expanded: true, detail: {}, editing: true, onEditSave })} />
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();

    rerender(<ReportCard {...baseProps({ expanded: true, detail: {}, editing: true, onEditSave, editSaving: true })} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  test('Cancel calls onEditCancel', async () => {
    const user = userEvent.setup();
    const onEditCancel = vi.fn();
    render(<ReportCard {...baseProps({ expanded: true, detail: {}, editing: true, onEditCancel })} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEditCancel).toHaveBeenCalledTimes(1);
  });

  test('shows the edit error message when present', () => {
    render(
      <ReportCard
        {...baseProps({ expanded: true, detail: {}, editing: true, editError: 'Reports can only be edited within 30 minutes of submission.' })}
      />
    );
    expect(screen.getByText(/within 30 minutes/)).toBeInTheDocument();
  });
});
