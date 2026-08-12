// UC-002 triage + UC-004 close — the manager's working screen for one record.
//
// Three things are worth pinning here, because each was a real defect:
//   * Triage sends only what changed, so the audit trail records real actions
//     rather than a re-save of every field.
//   * Status is not a control. It moves when work moves (assigned, submitted,
//     reviewed); a dropdown let a manager mark something Resolved that no
//     inspector had seen.
//   * Closing is refused until an inspector has reviewed the work, and the
//     panel says so up front instead of failing on submit.
//
// The API and auth are mocked; the page, its forms and its guards are real.
import { configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// The whole frontend suite runs these files in parallel with two dozen others,
// and a full MUI page in jsdom is slow enough under that load to exceed
// testing-library's 1s default. Scoped to this file — vitest isolates modules
// per test file, so it cannot affect anyone else's suite.
configure({ asyncUtilTimeout: 5000 });

const mockUseAuth = vi.fn();
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../src/services/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

// The canvas pad has its own suite; here it only has to exist and report ink.
vi.mock('../../src/components/SignaturePad', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function MockPad({ label }, ref) {
      useImperativeHandle(ref, () => ({
        isEmpty: () => false,
        clear: () => {},
        toBlob: async () => new Blob(['png'], { type: 'image/png' }),
      }));
      return <div data-testid="signature-pad">{label}</div>;
    }),
  };
});

import api from '../../src/services/api';
import InspectionDetailPage from '../../src/pages/InspectionDetailPage';

const MANAGER = { profile: { role: 'manager', full_name: 'Mdm Tan' } };
const INSPECTOR = { profile: { role: 'inspector', full_name: 'Nurul Aisyah' } };

// A record the contractor has finished: 'Rectified' is stored, and shown as
// "Pending View By Inspector".
function record(overrides = {}) {
  return {
    id: 'insp-1',
    // source_type is dereferenced directly by the header (.replace), so it is
    // required rather than optional in this fixture.
    source_type: 'resident_complaint',
    ai_priority_score: 72,
    created_at: '2026-08-01T02:00:00.000Z',
    title: 'Lift door not closing',
    description: 'Judders halfway.',
    status: 'Rectified',
    priority: 'High',
    category: 'Lift',
    location_block: '44A',
    location_unit: '#12-05',
    contractor_id: null,
    target_deadline: null,
    inspector_id: null,
    is_deleted: false,
    reopen_count: 0,
    photo_url: null,
    checklist_results: [],
    signatures: [],
    history: [],
    ...overrides,
  };
}

const CONTRACTORS = [{ id: 'con-1', name: 'Otis Service SG', brands_serviced: 'Otis' }];
const INSPECTORS = [{ id: 'insp-user-1', full_name: 'Nurul Aisyah', email: 'n@example.com' }];

// The page fires three GETs for a manager and one for an inspector.
function mockLoad(ins = record()) {
  api.get.mockImplementation((url) => {
    if (url.startsWith('/api/inspections/')) return Promise.resolve({ data: ins });
    if (url === '/api/contractors') return Promise.resolve({ data: CONTRACTORS });
    if (url === '/api/users/inspectors') return Promise.resolve({ data: INSPECTORS });
    return Promise.resolve({ data: [] });
  });
}

// Rendered through a real route, not bare: the page reads the record id from
// useParams, so without a matching Route it would fetch /api/inspections/undefined.
async function renderPage(auth = MANAGER) {
  mockUseAuth.mockReturnValue(auth);
  render(
    <MemoryRouter initialEntries={['/inspections/insp-1']}>
      <Routes>
        <Route path="/inspections/:id" element={<InspectionDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText('Lift door not closing');
}

async function pickOption(user, fieldName, optionName) {
  const field = await screen.findByRole('combobox', { name: new RegExp(fieldName, 'i') }, { timeout: 5000 });
  await user.click(field);
  await user.click(await screen.findByRole('option', { name: optionName }, { timeout: 5000 }));
}

describe('InspectionDetailPage', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.patch.mockReset();
    api.post.mockReset();
    api.patch.mockResolvedValue({ data: {} });
    api.post.mockResolvedValue({ data: {} });
    mockLoad();
  });

  describe('triage', () => {
    test('saving with nothing edited changes nothing and says so', async () => {
      const user = userEvent.setup({ delay: null });
      await renderPage();

      await user.click(screen.getByRole('button', { name: /Save changes/i }));

      expect(await screen.findByText('Nothing changed.')).toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
    });

    // Only the edited field travels: a PATCH carrying every field would write
    // an audit row implying the manager changed things they never touched.
    test('sends only the field that changed', async () => {
      const user = userEvent.setup({ delay: null });
      await renderPage();

      await pickOption(user, 'Category', 'Doors');
      await user.click(screen.getByRole('button', { name: /Save changes/i }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
      const [url, body] = api.patch.mock.calls[0];
      expect(url).toBe('/api/inspections/insp-1');
      expect(body).toEqual({ category: 'Doors' });
    });

    test('a triage note rides along with the change', async () => {
      const user = userEvent.setup({ delay: null });
      await renderPage();

      await pickOption(user, 'Priority', 'Critical');
      await user.type(screen.getByLabelText(/note/i, { exact: false }), 'Escalated after a fall.');
      await user.click(screen.getByRole('button', { name: /Save changes/i }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
      expect(api.patch.mock.calls[0][1]).toEqual({
        priority: 'Critical',
        note: 'Escalated after a fall.',
      });
    });

    test('surfaces the backend message when the save is refused', async () => {
      api.patch.mockRejectedValue({
        response: { data: { message: 'category must be one of: …' } },
      });
      const user = userEvent.setup({ delay: null });
      await renderPage();

      await pickOption(user, 'Category', 'Doors');
      await user.click(screen.getByRole('button', { name: /Save changes/i }));

      expect(await screen.findByText('category must be one of: …')).toBeInTheDocument();
    });
  });

  describe('status', () => {
    // The workflow owns the status. It is shown, not chosen.
    test('is read-only, and reads as the friendly label', async () => {
      await renderPage();

      const status = screen.getByLabelText(/^Status/i, { exact: false });
      expect(status).toHaveValue('Pending View By Inspector');
      expect(status).toHaveAttribute('readonly');
    });

    test('offers no status options to pick from', async () => {
      const user = userEvent.setup({ delay: null });
      await renderPage();

      await user.click(screen.getByLabelText(/^Status/i, { exact: false }));

      expect(screen.queryByRole('option', { name: 'Resolved' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Open' })).not.toBeInTheDocument();
    });
  });

  describe('closing', () => {
    test('is refused until an inspector has reviewed the work', async () => {
      await renderPage();

      expect(
        screen.getByText(/No inspector has marked this record as reviewed yet/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Close & archive record/i })).toBeDisabled();
    });

    // The gate reads the audit trail the detail endpoint already returns.
    test('is allowed once the review is in the record history', async () => {
      mockLoad(
        record({
          inspector_id: 'insp-user-1',
          history: [
            {
              action: 'Reviewed by Inspector',
              previous_status: 'Rectified',
              new_status: 'Resolved',
              created_at: '2026-08-08T02:00:00.000Z',
            },
          ],
          status: 'Resolved',
        })
      );
      await renderPage();

      expect(
        screen.queryByText(/No inspector has marked this record as reviewed yet/i)
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Close & archive record/i })).toBeEnabled();
    });

    test('an archived record offers no triage form or close panel at all', async () => {
      mockLoad(record({ status: 'Closed', is_deleted: true }));
      await renderPage();

      expect(screen.getByText(/closed and archived — read only/i)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Close & archive record/i })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Save changes/i })).not.toBeInTheDocument();
    });
  });

  describe('as an inspector', () => {
    test('gets a read-only view — no triage, no closing', async () => {
      await renderPage(INSPECTOR);

      expect(screen.queryByRole('button', { name: /Save changes/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Close & archive record/i })
      ).not.toBeInTheDocument();
      // …and never calls the manager-only endpoints, which would 403.
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(api.get).not.toHaveBeenCalledWith('/api/contractors');
    });

    test('can mark the work reviewed, which is what resolves it', async () => {
      const user = userEvent.setup({ delay: null });
      await renderPage(INSPECTOR);

      await user.click(screen.getByRole('button', { name: /^Mark as reviewed$/i }));

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(api.post).toHaveBeenCalledWith('/api/inspections/insp-1/review', expect.anything());
    });

    test('has nothing to review on a record the contractor has not finished', async () => {
      mockLoad(record({ status: 'Assigned' }));
      await renderPage(INSPECTOR);

      expect(
        screen.queryByRole('button', { name: /^Mark as reviewed$/i })
      ).not.toBeInTheDocument();
    });
  });
});
