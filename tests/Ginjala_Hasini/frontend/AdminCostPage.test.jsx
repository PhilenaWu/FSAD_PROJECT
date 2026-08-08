// Component tests for the UC-011 admin cost dashboard.
//
// The data layer, the chart canvases and the auth/socket contexts are mocked;
// what is under test is the page's own behaviour — that it renders the figures
// the API returned, that it never renders figures the API did not return, and
// that a superseded request cannot repaint the page.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks ------------------------------------------------------------------

vi.mock('../../../frontend/src/context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'admin' } }),
}));
vi.mock('../../../frontend/src/context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

// Chart.js needs a real canvas; the charts are not what these tests are about.
vi.mock('../../../frontend/src/components/cost/CategoryBarChart', () => ({
  default: ({ data }) => <div data-testid="category-chart">{data.length} categories</div>,
}));
vi.mock('../../../frontend/src/components/cost/CostTrendChart', () => ({
  default: ({ data }) => <div data-testid="trend-chart">{data.length} months</div>,
}));

vi.mock('../../../frontend/src/services/costService', async (importOriginal) => {
  // buildInsights and the threshold are pure; only the network calls are faked.
  const actual = await importOriginal();
  return {
    ...actual,
    getCostFilterOptions: vi.fn(),
    getCostSummary: vi.fn(),
    getCostAnalytics: vi.fn(),
    getLiftWatchlist: vi.fn(),
    exportCostPptx: vi.fn(),
  };
});

import {
  getCostFilterOptions,
  getCostSummary,
  getCostAnalytics,
  getLiftWatchlist,
} from '../../../frontend/src/services/costService';
import AdminCostPage from '../../../frontend/src/pages/AdminCostPage';

// --- Fixtures ---------------------------------------------------------------

const summary = (over = {}) => ({
  total_actual: 268600,
  total_projected: 7968.71,
  jobs: 255,
  prior_actual: 66900,
  variance_pct: 2.8,
  ...over,
});

const analytics = (over = {}) => ({
  jobs: [
    {
      id: 'job-1',
      closed_at: '2026-07-24',
      block: '44A',
      category: 'Doors',
      lift: '44A-L1',
      contractor: 'Otis Elevator Co.',
      actual_cost: 1180,
    },
  ],
  byCategory: [{ category: 'Doors', actual_cost: 84163, jobs: 72 }],
  byContractor: [{ contractor: 'Otis Elevator Co.', actual_cost: 101366, jobs: 96 }],
  trend: {
    data: [{ month: '2026-07', actual_cost: 22000, jobs: 20 }],
    forecast: null,
    backtest: null,
    top_mover: null,
  },
  benchmarks: {},
  ...over,
});

const watchlist = (rows = []) => ({ data: rows });

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminCostPage />
    </MemoryRouter>
  );

beforeEach(() => {
  getCostFilterOptions.mockResolvedValue({ blocks: ['44A'], categories: ['Doors'], contractors: [] });
  getCostSummary.mockResolvedValue(summary());
  getCostAnalytics.mockResolvedValue(analytics());
  getLiftWatchlist.mockResolvedValue(watchlist());
});

// --- Tests ------------------------------------------------------------------

describe('AdminCostPage', () => {
  test('renders the KPI figures the API returned, formatted as money', async () => {
    renderPage();

    expect(await screen.findByText('$268,600.00')).toBeInTheDocument();
    expect(screen.getByText('$7,968.71')).toBeInTheDocument();
    // The job count appears in the tile caption and again in the Insights
    // sentence — both are derived from the same response.
    expect(screen.getAllByText(/255 closed jobs/).length).toBeGreaterThan(0);
    // 268600 / 255
    expect(screen.getByText('$1,053.33')).toBeInTheDocument();
    expect(screen.getByText('+2.8% vs prior period')).toBeInTheDocument();
  });

  test('shows a dash, not a zero, when there is no prior window to compare', async () => {
    getCostSummary.mockResolvedValue(summary({ variance_pct: null, prior_actual: 0 }));
    renderPage();

    expect(await screen.findByText('no prior-period spend to compare')).toBeInTheDocument();
    expect(screen.queryByText(/vs prior period/)).not.toBeInTheDocument();
  });

  test('a contractor filter blanks projected exposure with an explanation, not a silent $0', async () => {
    // The server zeroes the projected series under a contractor filter —
    // ai_predictions carries no contractor to attribute exposure to.
    getCostSummary.mockResolvedValue(summary({ total_projected: 0 }));
    render(
      <MemoryRouter initialEntries={['/admin/costs?contractorId=00000000-0000-4000-8000-000000000001']}>
        <AdminCostPage />
      </MemoryRouter>
    );

    // Scope to the tile itself — a bare '—' can legitimately appear elsewhere.
    const label = await screen.findByText('Projected exposure');
    const tile = within(label.closest('.MuiPaper-root'));
    expect(tile.getByText('—')).toBeInTheDocument();
    expect(tile.getByText(/not shown per contractor/)).toBeInTheDocument();
    expect(tile.queryByText('$0.00')).not.toBeInTheDocument();
  });

  test('an empty result renders empty states and disables the exports', async () => {
    getCostSummary.mockResolvedValue(summary({ total_actual: 0, jobs: 0, variance_pct: null }));
    getCostAnalytics.mockResolvedValue(
      analytics({ jobs: [], byCategory: [], byContractor: [], trend: { data: [], forecast: null, backtest: null, top_mover: null } })
    );
    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /Export CSV/i })).toBeDisabled());
    expect(screen.getByRole('button', { name: /PowerPoint/i })).toBeDisabled();
    expect(screen.getAllByText(/No costed jobs match the current filters/).length).toBeGreaterThan(0);
  });

  test('a failed load shows the retry banner and keeps no figures on screen', async () => {
    getCostSummary.mockRejectedValue(new Error('network down'));
    renderPage();

    expect(await screen.findByText(/Could not load cost data/)).toBeInTheDocument();
    expect(screen.queryByText('$268,600.00')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  test('Retry refetches — the click event must not be taken for a stale-check', async () => {
    getCostSummary.mockRejectedValueOnce(new Error('network down'));
    renderPage();

    const retry = await screen.findByRole('button', { name: /Retry/i });
    getCostSummary.mockResolvedValue(summary());
    await userEvent.click(retry);

    // If the click event were passed as `isStale`, calling it would throw and
    // no figures would ever appear.
    expect(await screen.findByText('$268,600.00')).toBeInTheDocument();
  });

  test('the watchlist grades each lift against the review threshold', async () => {
    getLiftWatchlist.mockResolvedValue(
      watchlist([
        { lift: '44A-L1', block: '44A', actual_cost: 69655, jobs: 57, pct_of_threshold: 116, months_to_review: 0 },
        { lift: '44B-L1', block: '44B', actual_cost: 47170, jobs: 37, pct_of_threshold: 79, months_to_review: 4 },
        { lift: '45B-L1', block: '45B', actual_cost: 17475, jobs: 12, pct_of_threshold: 29, months_to_review: 31 },
      ])
    );
    renderPage();

    // Queried from the status chip outwards: lift codes also appear in the
    // jobs table's Lift column, so the chip is the unambiguous anchor.
    const past = (await screen.findByText('Review replacement')).closest('tr');
    expect(within(past).getByText('44A-L1')).toBeInTheDocument();
    expect(within(past).getByText('now')).toBeInTheDocument();

    const approaching = screen.getByText('Approaching review').closest('tr');
    expect(within(approaching).getByText('44B-L1')).toBeInTheDocument();
    expect(within(approaching).getByText('~4 mo')).toBeInTheDocument();

    const healthy = screen.getByText('Healthy').closest('tr');
    expect(within(healthy).getByText('45B-L1')).toBeInTheDocument();
  });

  test('a job with no recent spend shows a dash, never a fabricated date', async () => {
    getLiftWatchlist.mockResolvedValue(
      watchlist([
        { lift: '44C-L1', block: '44C', actual_cost: 400, jobs: 1, pct_of_threshold: 1, months_to_review: null },
      ])
    );
    renderPage();

    const row = (await screen.findByText('44C-L1')).closest('tr');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  test('a superseded response cannot repaint the page (stale-request race)', async () => {
    // The first load is slow and carries the OLD figures; a filter change
    // fires a second, fast load with the NEW ones. Before the isStale guard,
    // the slow response landed last and the page showed figures that
    // contradicted the filter bar.
    // The two totals must not collide with any figure the page derives from
    // them (the average-per-job tile is total ÷ jobs), or the assertion below
    // can trip on the page's own arithmetic instead of on stale data.
    const STALE = 987654;
    const FRESH = 222222;

    let releaseSlow;
    const slow = new Promise((resolve) => {
      releaseSlow = () => resolve(summary({ total_actual: STALE, jobs: 3 }));
    });

    getCostSummary.mockReturnValueOnce(slow).mockResolvedValue(summary({ total_actual: FRESH, jobs: 2 }));

    renderPage();

    // Change the filters for real, the way a user would: the quick-range chip
    // rewrites the URL, which re-runs the fetch.
    await userEvent.click(await screen.findByRole('button', { name: 'Last 30 days' }));

    expect(await screen.findByText('$222,222.00')).toBeInTheDocument();

    // Now let the stale request finish. It must be discarded.
    releaseSlow();
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText('$987,654.00')).not.toBeInTheDocument();
    expect(screen.getByText('$222,222.00')).toBeInTheDocument();
  });

  test('the jobs table shows the latest 10, and All reveals the rest', async () => {
    // 14 jobs, newest first, each $100 apart so the sort is checkable.
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `job-${i}`,
      closed_at: `2026-07-${String(28 - i).padStart(2, '0')}`,
      block: '44A',
      category: 'Doors',
      lift: '44A-L1',
      contractor: 'Otis Elevator Co.',
      actual_cost: 100 + i,
    }));
    getCostAnalytics.mockResolvedValue(analytics({ jobs: many }));
    renderPage();

    expect(await screen.findByRole('button', { name: /Latest 10/i })).toBeInTheDocument();
    expect(screen.getByText('2026-07-28')).toBeInTheDocument();
    expect(screen.queryByText('2026-07-15')).not.toBeInTheDocument(); // 14th row

    await userEvent.click(screen.getByRole('button', { name: /All \(14\)/i }));
    expect(screen.getByText('2026-07-15')).toBeInTheDocument();
  });

  test('sorting runs over every row, not just the ten on screen', async () => {
    // The dearest job is the OLDEST, so it is outside the default ten-row
    // window — sorting by cost has to reach it.
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `job-${i}`,
      closed_at: `2026-07-${String(24 - i).padStart(2, '0')}`,
      block: '44A',
      category: 'Doors',
      lift: null,
      contractor: 'Otis Elevator Co.',
      actual_cost: 100 + i * 10,
    }));
    getCostAnalytics.mockResolvedValue(analytics({ jobs: many }));
    renderPage();

    // "Actual cost" is a sort label on the contractor table too; the "Closed"
    // header is unique to the jobs table, so scope through it.
    const jobsTable = (await screen.findByText('Closed')).closest('table');
    await userEvent.click(within(jobsTable).getByRole('button', { name: /Actual cost/i }));
    expect(screen.getByText('$210.00')).toBeInTheDocument(); // dearest, oldest row
  });

  test('a job with no lift renders a dash in the Lift column', async () => {
    getCostAnalytics.mockResolvedValue(
      analytics({ jobs: [{ ...analytics().jobs[0], lift: null }] })
    );
    renderPage();

    const row = (await screen.findByText('2026-07-24')).closest('tr');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  test('the outlier filter narrows to jobs over twice their category average', async () => {
    // Category average is 84163/72 ≈ $1,169, so only the $9,000 job is an outlier.
    const rows = [
      { ...analytics().jobs[0], id: 'normal', actual_cost: 1180 },
      { ...analytics().jobs[0], id: 'big', closed_at: '2026-07-01', actual_cost: 9000 },
    ];
    getCostAnalytics.mockResolvedValue(analytics({ jobs: rows }));
    renderPage();

    const filter = await screen.findByRole('button', { name: /Outliers \(1\)/i });
    expect(screen.getByText('$1,180.00')).toBeInTheDocument();

    await userEvent.click(filter);
    expect(screen.getByText('$9,000.00')).toBeInTheDocument();
    expect(screen.queryByText('$1,180.00')).not.toBeInTheDocument();
  });

  test('the outlier filter is disabled when nothing qualifies', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Outliers \(0\)/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  test('the table category and contractor filters narrow the rows, not the charts', async () => {
    const rows = [
      { ...analytics().jobs[0], id: 'a', category: 'Doors', contractor: 'Otis Elevator Co.', actual_cost: 1180 },
      { ...analytics().jobs[0], id: 'b', closed_at: '2026-07-20', category: 'Lift', contractor: 'KONE Pte Ltd', actual_cost: 1820 },
    ];
    getCostAnalytics.mockResolvedValue(analytics({ jobs: rows }));
    renderPage();

    expect(await screen.findByText('$1,180.00')).toBeInTheDocument();
    expect(screen.getByText('$1,820.00')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Category'));
    await userEvent.click(await screen.findByRole('option', { name: 'Lift' }));

    expect(screen.queryByText('$1,180.00')).not.toBeInTheDocument();
    expect(screen.getByText('$1,820.00')).toBeInTheDocument();
    // The KPI tiles keep the whole filtered period — these controls are local.
    expect(screen.getByText('$268,600.00')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Contractor'));
    await userEvent.click(await screen.findByRole('option', { name: 'Otis Elevator Co.' }));
    expect(screen.getByText(/No jobs match these table filters/)).toBeInTheDocument();
  });

  test('the Order control and the column headers drive one shared sort', async () => {
    const rows = [
      { ...analytics().jobs[0], id: 'cheap', closed_at: '2026-07-24', actual_cost: 100 },
      { ...analytics().jobs[0], id: 'dear', closed_at: '2026-07-01', actual_cost: 9000 },
    ];
    getCostAnalytics.mockResolvedValue(analytics({ jobs: rows }));
    renderPage();

    // Default is newest first, so the cheap 24 Jul row leads.
    const order = await screen.findByLabelText('Order');
    expect(within(order.closest('.MuiFormControl-root')).getByText('Newest first')).toBeInTheDocument();

    await userEvent.click(order);
    await userEvent.click(await screen.findByRole('option', { name: 'Highest cost' }));

    // Three tables share the page, so scope to the jobs one before reading
    // its first data row.
    const jobsTable = screen.getByText('Closed').closest('table');
    const firstRow = within(jobsTable).getAllByRole('row')[1];
    expect(within(firstRow).getByText('$9,000.00')).toBeInTheDocument();

    // Clicking a column the shortcuts don't cover leaves the control honest
    // rather than showing a stale order.
    await userEvent.click(within(jobsTable).getByRole('button', { name: /Category/i }));
    expect(screen.getByText('sorted by a column')).toBeInTheDocument();
  });

  test('a non-admin is refused the page outright', async () => {
    vi.doMock('../../../frontend/src/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'manager' } }) }));
    vi.resetModules();
    const { default: Page } = await import('../../../frontend/src/pages/AdminCostPage');

    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    );

    expect(
      await screen.findByText('This dashboard is only available to administrators.')
    ).toBeInTheDocument();
  });
});
