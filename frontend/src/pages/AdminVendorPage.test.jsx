// Component tests for the UC-012 vendor accounts page — the filter design it
// now shares with the cost dashboard's jobs table: status chips carrying live
// counts, an Order shortcut wired to the same sort as the column headers, and
// a row cap. The service layer and contexts are mocked; the DOM is real.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'admin' } }),
}));
vi.mock('../context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

vi.mock('../services/vendorService', () => ({
  listVendors: vi.fn(),
  onboardVendor: vi.fn(),
  renewVendor: vi.fn(),
  suspendVendor: vi.fn(),
  updateVendorDetails: vi.fn(),
  getVendorHistory: vi.fn(),
  runExpiryCheck: vi.fn(),
}));

import { listVendors } from '../services/vendorService';
import AdminVendorPage from './AdminVendorPage';

// Shaped like GET /api/admin/vendors rows.
const vendor = (over = {}) => ({
  id: `v-${over.name ?? 'x'}`,
  name: 'Otis Elevator Co.',
  contact_email: 'defects@otis.example.com',
  brands_serviced: 'Otis',
  account_holder: 'Sing En',
  job_title: 'Service Manager',
  login_email: 'sing.en@otis.example.com',
  contract_start: '2025-08-01',
  contract_end: '2027-08-01',
  days_until_expiry: 400,
  status: 'active',
  access_reason: 'Lift servicing',
  contract_doc_url: null,
  ...over,
});

const VENDORS = [
  vendor({ name: 'Expiring Soon Co.', days_until_expiry: 12, status: 'active' }),
  vendor({ name: 'Lapsed Lifts', days_until_expiry: -5, status: 'active' }),
  vendor({ name: 'Suspended Servicing', days_until_expiry: 200, status: 'suspended' }),
  vendor({ name: 'Healthy Hoists', days_until_expiry: 400, status: 'active' }),
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminVendorPage />
    </MemoryRouter>
  );

beforeEach(() => {
  listVendors.mockResolvedValue({ data: { data: VENDORS } });
});

describe('AdminVendorPage — filters', () => {
  test('status chips carry live counts drawn from the vendor rows', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'Expiring ≤30d (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expired (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspended (1)' })).toBeInTheDocument();
    // "Expiring" is active-only and excludes the lapsed row, so 2 remain active.
    expect(screen.getByRole('button', { name: 'Active (3)' })).toBeInTheDocument();
  });

  test('a chip filters the table, and clicking it again clears the filter', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Suspended (1)' }));
    expect(screen.getByText('Suspended Servicing')).toBeInTheDocument();
    expect(screen.queryByText('Healthy Hoists')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Suspended (1)' }));
    expect(screen.getByText('Healthy Hoists')).toBeInTheDocument();
  });

  test('a status with nothing to show is disabled rather than a dead end', async () => {
    listVendors.mockResolvedValue({ data: { data: [vendor({ name: 'Only One' })] } });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Expired (0)' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  test('the search box narrows the rows and the chip counts with them', async () => {
    renderPage();

    await userEvent.type(
      await screen.findByPlaceholderText(/Search vendor/i),
      'Lapsed'
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expired (1)' })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Active (1)' })).toBeInTheDocument();
    expect(screen.queryByText('Healthy Hoists')).not.toBeInTheDocument();
  });

  test('defaults to soonest-expiring first, as the use case specifies', async () => {
    renderPage();

    await screen.findByText('Expiring Soon Co.');
    const rows = screen.getAllByRole('row').slice(1); // drop the header
    expect(within(rows[0]).getByText('Lapsed Lifts')).toBeInTheDocument(); // -5 days
    expect(within(rows[1]).getByText('Expiring Soon Co.')).toBeInTheDocument(); // 12 days
  });

  test('the Order control re-sorts, and a column click keeps it honest', async () => {
    renderPage();

    const order = await screen.findByLabelText('Order');
    await userEvent.click(order);
    await userEvent.click(await screen.findByRole('option', { name: 'Vendor A–Z' }));

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Expiring Soon Co.')).toBeInTheDocument();

    // Sorting by a column with no shortcut clears the control's selection.
    await userEvent.click(screen.getByRole('button', { name: /Account holder/i }));
    expect(screen.getByText('sorted by a column')).toBeInTheDocument();
  });

  test('the row cap shows the first 10 until All is chosen', async () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      vendor({ name: `Vendor ${String(i).padStart(2, '0')}`, days_until_expiry: i })
    );
    listVendors.mockResolvedValue({ data: { data: many } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /First 10/i }));
    expect(screen.queryByText('Vendor 12')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /All \(14\)/i }));
    expect(screen.getByText('Vendor 12')).toBeInTheDocument();
  });
});
