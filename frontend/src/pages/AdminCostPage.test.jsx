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

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'admin' } }),
}));
vi.mock('../context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

// Chart.js needs a real canvas; the charts are not what these tests are about.
vi.mock('../components/cost/CategoryBarChart', () => ({
  default: ({ data }) => <div data-testid="category-chart">{data.length} categories</div>,
}));
vi.mock('../components/cost/CostTrendChart', () => ({
  default: ({ data }) => <div data-testid="trend-chart">{data.length} months</div>,
}));

vi.mock('../services/costService', async (importOriginal) => {
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
} from '../services/costService';
import AdminCostPage from './AdminCostPage';

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

    const past = (await screen.findByText('44A-L1')).closest('tr');
    expect(within(past).getByText('Review replacement')).toBeInTheDocument();
    expect(within(past).getByText('now')).toBeInTheDocument();

    const approaching = screen.getByText('44B-L1').closest('tr');
    expect(within(approaching).getByText('Approaching review')).toBeInTheDocument();
    expect(within(approaching).getByText('~4 mo')).toBeInTheDocument();

    const healthy = screen.getByText('45B-L1').closest('tr');
    expect(within(healthy).getByText('Healthy')).toBeInTheDocument();
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

  test('a non-admin is refused the page outright', async () => {
    vi.doMock('../context/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'manager' } }) }));
    vi.resetModules();
    const { default: Page } = await import('./AdminCostPage');

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
