// Tests for the UC-005 data layer (services/analyticsService.js).
//
// Every page test mocks this module out, so without this file the actual URLs
// and query parameters are asserted nowhere on the frontend — a typo'd path
// would still render a green dashboard test and a 404 in the browser. These
// pin the request each function makes and the unwrapping of `res.data`.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import api from '../../services/api';
import {
  SLA_THRESHOLD_HRS,
  getFilterOptions,
  getSummary,
  getHeatmap,
  getTrends,
  getSlaCompliance,
  getContractorScorecard,
  getPriorityQueue,
  getRecommendations,
  acceptRecommendation,
  dismissRecommendation,
  runAnalysis,
  exportPptx,
} from '../../services/analyticsService';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const FILTERS = { startDate: '2026-01-01', endDate: '2026-06-30', block: '44A' };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { data: [] } });
  api.post.mockResolvedValue({ data: {} });
});

describe('analyticsService — endpoints', () => {
  // One case per dashboard panel. The path is the contract with
  // backend/src/routes/analytics.js; if the two ever disagree the panel goes
  // blank in the browser while every page test still passes.
  test.each([
    ['getFilterOptions', getFilterOptions, '/api/analytics/filter-options'],
    ['getSummary', getSummary, '/api/analytics/summary'],
    ['getHeatmap', getHeatmap, '/api/analytics/issues-by-block'],
    ['getTrends', getTrends, '/api/analytics/trends'],
    ['getSlaCompliance', getSlaCompliance, '/api/analytics/sla-compliance'],
    ['getContractorScorecard', getContractorScorecard, '/api/analytics/contractor-scorecard'],
    ['getPriorityQueue', getPriorityQueue, '/api/analytics/priority-queue'],
  ])('%s calls %s', async (_name, fn, path) => {
    await fn();
    expect(api.get.mock.calls[0][0]).toBe(path);
  });

  test('filter-options is the one endpoint that takes no parameters', async () => {
    // Its dropdown values must not narrow themselves out of the options needed
    // to undo the current selection, so no filters are sent at all.
    await getFilterOptions();

    expect(api.get).toHaveBeenCalledWith('/api/analytics/filter-options');
  });

  test('filters are sent as query parameters, not baked into the path', async () => {
    await getSummary(FILTERS);

    expect(api.get).toHaveBeenCalledWith('/api/analytics/summary', { params: FILTERS });
  });

  test('an unfiltered call still sends an empty params object', async () => {
    // The backend treats a missing filter as "all"; sending {} rather than
    // undefined keeps axios from serialising anything unexpected.
    await getHeatmap();

    expect(api.get).toHaveBeenCalledWith('/api/analytics/issues-by-block', { params: {} });
  });

  test('the response body is unwrapped, so pages never see the axios envelope', async () => {
    api.get.mockResolvedValue({ data: { total_open: 12 }, status: 200, headers: {} });

    await expect(getSummary()).resolves.toEqual({ total_open: 12 });
  });

  test('a request failure propagates so the page can show its error state', async () => {
    api.get.mockRejectedValue(new Error('network'));

    await expect(getSummary()).rejects.toThrow('network');
  });
});

describe('analyticsService — recommendations (HLD §6.4)', () => {
  test('the alert list asks only for Active alerts', async () => {
    await getRecommendations();

    expect(api.get).toHaveBeenCalledWith('/api/recommendations', {
      params: { status: 'Active' },
    });
  });

  test('accept and dismiss post to the id they were given', async () => {
    await acceptRecommendation('alert-7');
    await dismissRecommendation('alert-8');

    expect(api.post).toHaveBeenCalledWith('/api/recommendations/alert-7/accept');
    expect(api.post).toHaveBeenCalledWith('/api/recommendations/alert-8/dismiss');
  });

  test('the manual analysis run is a GET, matching the cron route it shares', async () => {
    await runAnalysis();

    expect(api.get).toHaveBeenCalledWith('/api/recommendations/run');
  });
});

describe('analyticsService — PowerPoint export', () => {
  test('sends the chosen views and the current filters in the body', async () => {
    await exportPptx(['summary', 'heatmap'], FILTERS);

    expect(api.post).toHaveBeenCalledWith('/api/export/pptx', {
      views: ['summary', 'heatmap'],
      filters: FILTERS,
    });
  });
});

describe('analyticsService — SLA threshold', () => {
  test('mirrors the backend SLA_THRESHOLD_HRS of 72', () => {
    // Duplicated deliberately (the gauge caption needs it client-side); this
    // is the assertion that notices if only one of the two is ever changed.
    expect(SLA_THRESHOLD_HRS).toBe(72);
  });
});
