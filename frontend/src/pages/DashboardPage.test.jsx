// Component tests for the UC-005 manager dashboard. The data layer, the chart
// canvases and the auth/socket contexts are mocked; what is under test is the
// page's own behaviour — the AI alert folding, the empty and failure states,
// and that a superseded request cannot repaint the page.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'manager' } }),
}));
vi.mock('../context/SocketContext', () => ({
  useSocket: () => ({ socket: null }),
}));

// Chart.js needs a real canvas; the charts are not what these tests are about.
vi.mock('../components/analytics/HeatmapChart', () => ({ default: () => <div data-testid="heatmap" /> }));
vi.mock('../components/analytics/TrendLineChart', () => ({ default: () => <div data-testid="trend" /> }));
vi.mock('../components/analytics/SlaGauge', () => ({ default: () => <div data-testid="sla" /> }));

vi.mock('../services/analyticsService', async (importOriginal) => ({
  ...(await importOriginal()),
  getFilterOptions: vi.fn(),
  getSummary: vi.fn(),
  getHeatmap: vi.fn(),
  getTrends: vi.fn(),
  getSlaCompliance: vi.fn(),
  getContractorScorecard: vi.fn(),
  getPriorityQueue: vi.fn(),
  getRecommendations: vi.fn(),
  acceptRecommendation: vi.fn(),
  dismissRecommendation: vi.fn(),
  runAnalysis: vi.fn(),
  exportPptx: vi.fn(),
}));

import {
  getFilterOptions,
  getSummary,
  getHeatmap,
  getTrends,
  getSlaCompliance,
  getContractorScorecard,
  getPriorityQueue,
  getRecommendations,
} from '../services/analyticsService';
import DashboardPage from './DashboardPage';

const alert = (n) => ({
  id: `alert-${n}`,
  location_block: `Block ${n}`,
  category: 'Electrical',
  velocity_pct: 67,
  estimated_cost: 439.91,
  alert_text: `High risk: alert number ${n}.`,
  status: 'Active',
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );

beforeEach(() => {
  getFilterOptions.mockResolvedValue({ blocks: ['44A'], categories: ['Doors'], sections: [] });
  getSummary.mockResolvedValue({
    open_count: 79,
    overdue_count: 61,
    avg_resolution_hours: 91.8,
    sla_percentage: 63.92,
    new_last_30: 93,
    new_prior_30: 60,
    new_records_change_pct: 55,
    sla_threshold_hrs: 72,
  });
  getHeatmap.mockResolvedValue({ data: [] });
  getTrends.mockResolvedValue({ data: [] });
  getSlaCompliance.mockResolvedValue({
    compliant_count: 163,
    total_resolved: 255,
    sla_percentage: 63.92,
    sla_threshold_hrs: 72,
  });
  getContractorScorecard.mockResolvedValue({ data: [] });
  getPriorityQueue.mockResolvedValue({ data: [] });
  getRecommendations.mockResolvedValue({ data: [] });
});

describe('DashboardPage — AI risk alerts', () => {
  test('shows only the three most recent, and says how many are waiting', async () => {
    getRecommendations.mockResolvedValue({ data: [1, 2, 3, 4, 5, 6, 7].map(alert) });
    renderPage();

    expect(await screen.findByText('7 active')).toBeInTheDocument();
    // The API returns newest-first, so the preview is the first three.
    expect(screen.getByText(/alert number 1\./)).toBeInTheDocument();
    expect(screen.getByText(/alert number 3\./)).toBeInTheDocument();
    expect(screen.queryByText(/alert number 4\./)).not.toBeInTheDocument();
    expect(screen.getByText(/Showing the 3 most recent of 7/)).toBeInTheDocument();
  });

  test('"View all" reveals the rest and can be collapsed again', async () => {
    getRecommendations.mockResolvedValue({ data: [1, 2, 3, 4, 5, 6, 7].map(alert) });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /View all 7/i }));
    expect(screen.getByText(/alert number 7\./)).toBeInTheDocument();
    expect(screen.queryByText(/Showing the 3 most recent/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Show fewer/i }));
    expect(screen.queryByText(/alert number 7\./)).not.toBeInTheDocument();
  });

  test('three or fewer alerts need no toggle at all', async () => {
    getRecommendations.mockResolvedValue({ data: [1, 2, 3].map(alert) });
    renderPage();

    expect(await screen.findByText('3 active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View all/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing the 3 most recent/)).not.toBeInTheDocument();
  });

  test('no alerts renders no alert section', async () => {
    renderPage();

    await waitFor(() => expect(getRecommendations).toHaveBeenCalled());
    expect(screen.queryByText('AI risk alerts')).not.toBeInTheDocument();
  });
});

describe('DashboardPage — data and failure states', () => {
  test('KPI figures come from the API response', async () => {
    renderPage();

    // SLA percentage and the open/overdue counts are all server-computed.
    expect(await screen.findByText('79')).toBeInTheDocument();
    expect(screen.getByText('61')).toBeInTheDocument();
  });

  test('a failed load shows the retry banner, and Retry refetches', async () => {
    getSummary.mockRejectedValueOnce(new Error('backend down'));
    renderPage();

    const retry = await screen.findByRole('button', { name: /Retry/i });
    await userEvent.click(retry);

    // The click event must not be mistaken for the stale-check callback.
    await waitFor(() => expect(screen.queryByText(/Could not load dashboard data/)).not.toBeInTheDocument());
  });

  test('a superseded response cannot repaint the page (stale-request race)', async () => {
    let releaseSlow;
    const slow = new Promise((resolve) => {
      releaseSlow = () => resolve({ data: [alert(99)] });
    });
    getRecommendations.mockReturnValueOnce(slow).mockResolvedValue({ data: [alert(1)] });

    renderPage();

    // Change the filters for real, the way a user would: the date field
    // rewrites the URL, which re-runs the fetch.
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-01-01' } });

    expect(await screen.findByText(/alert number 1\./)).toBeInTheDocument();

    releaseSlow();
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText(/alert number 99\./)).not.toBeInTheDocument();
  });
});
