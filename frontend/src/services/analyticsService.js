// UC-005 analytics data layer. Response shapes follow HIGH_LEVEL_DESIGN.md
// §6.3 (analytics) and §6.4 (recommendations) exactly. Flip USE_MOCK to true
// to demo the dashboard without a running backend/database — mock payloads
// live in mocks/analyticsMocks.js.
import api from './api';
import {
  MOCK_SUMMARY,
  MOCK_HEATMAP,
  MOCK_TRENDS,
  MOCK_SLA,
  MOCK_SCORECARD,
  MOCK_PRIORITY_QUEUE,
  MOCK_RECOMMENDATIONS,
} from '../mocks/analyticsMocks';

// Live backend. Flip to true to serve the mock dataset instead.
const USE_MOCK = false;

// SLA resolution target — mirror of the backend's SLA_THRESHOLD_HRS
// (backend/src/controllers/analyticsController.js). Keep the two in sync.
export const SLA_THRESHOLD_HRS = 72;

// Apply the ?block / ?category / ?priority / ?status filters client-side so
// the filter controls are demonstrably live even in mock mode. Date filters
// are accepted but not applied to the static mock set.
function applyFilters(rows, { block, category, priority, status } = {}) {
  return rows.filter(
    (r) =>
      (!block || (r.block ?? r.location_block) === block) &&
      (!category || r.category === category) &&
      (!priority || r.priority === priority) &&
      (!status || r.status === status)
  );
}

const delay = (data) =>
  new Promise((resolve) => setTimeout(() => resolve(data), 300));

// ---------------------------------------------------------------------------
// Public API — each mirrors one backend endpoint.
// ---------------------------------------------------------------------------

// GET /api/analytics/filter-options → { blocks: [...], categories: [...] }
// Dropdown options come from the data itself — nothing hardcoded.
export async function getFilterOptions() {
  if (USE_MOCK) {
    return delay({
      blocks: [...new Set(MOCK_HEATMAP.map((r) => r.block))].sort(),
      categories: [...new Set(MOCK_HEATMAP.map((r) => r.category))].sort(),
    });
  }
  const res = await api.get('/api/analytics/filter-options');
  return res.data;
}

// GET /api/analytics/summary → KPI tiles with vs-prior-30-days movement
export async function getSummary(filters = {}) {
  if (USE_MOCK) return delay(MOCK_SUMMARY);
  const res = await api.get('/api/analytics/summary', { params: filters });
  return res.data;
}

// GET /api/analytics/issues-by-block → { data: [{ block, category, count }] }
export async function getHeatmap(filters = {}) {
  if (USE_MOCK) return delay({ data: applyFilters(MOCK_HEATMAP, filters) });
  const res = await api.get('/api/analytics/issues-by-block', { params: filters });
  return res.data;
}

// GET /api/analytics/trends → { data: [{ date, count }] }
export async function getTrends(filters = {}) {
  if (USE_MOCK) return delay({ data: MOCK_TRENDS });
  const res = await api.get('/api/analytics/trends', { params: filters });
  return res.data;
}

// GET /api/analytics/sla-compliance → { compliant_count, total_resolved, sla_percentage, sla_threshold_hrs }
export async function getSlaCompliance(filters = {}) {
  if (USE_MOCK) return delay(MOCK_SLA);
  const res = await api.get('/api/analytics/sla-compliance', { params: filters });
  return res.data;
}

// GET /api/analytics/contractor-scorecard → { data: [...] }
export async function getContractorScorecard(filters = {}) {
  if (USE_MOCK) return delay({ data: MOCK_SCORECARD });
  const res = await api.get('/api/analytics/contractor-scorecard', { params: filters });
  return res.data;
}

// GET /api/analytics/priority-queue → { data: [...] }
export async function getPriorityQueue(filters = {}) {
  if (USE_MOCK) return delay({ data: applyFilters(MOCK_PRIORITY_QUEUE, filters) });
  const res = await api.get('/api/analytics/priority-queue', { params: filters });
  return res.data;
}

// GET /api/recommendations?status=Active → { data: [...], total } (HLD §6.4)
export async function getRecommendations() {
  if (USE_MOCK) return delay({ data: MOCK_RECOMMENDATIONS.filter((r) => r.status === 'Active') });
  const res = await api.get('/api/recommendations', { params: { status: 'Active' } });
  return res.data;
}

// POST /api/recommendations/:id/accept — mock flips status locally.
export async function acceptRecommendation(id) {
  if (USE_MOCK) {
    const rec = MOCK_RECOMMENDATIONS.find((r) => r.id === id);
    if (rec) rec.status = 'Accepted';
    return delay({ prediction_id: id, status: 'Accepted' });
  }
  const res = await api.post(`/api/recommendations/${id}/accept`);
  return res.data;
}

// POST /api/recommendations/:id/dismiss
export async function dismissRecommendation(id) {
  if (USE_MOCK) {
    const rec = MOCK_RECOMMENDATIONS.find((r) => r.id === id);
    if (rec) rec.status = 'Dismissed';
    return delay({ prediction_id: id, status: 'Dismissed' });
  }
  const res = await api.post(`/api/recommendations/${id}/dismiss`);
  return res.data;
}

// GET /api/recommendations/run — nightly analysis, also manager-triggerable.
// UC-006 (not built yet); callers handle the failure with a toast.
export async function runAnalysis() {
  if (USE_MOCK) {
    return delay(Promise.reject(new Error('Run Analysis needs the UC-006 backend — coming soon.')));
  }
  const res = await api.get('/api/recommendations/run');
  return res.data;
}

// POST /api/export/pptx → { pptx_url } (HLD §6.11)
export async function exportPptx(views, filters) {
  if (USE_MOCK) {
    return delay(Promise.reject(new Error('PowerPoint export needs the backend — coming with the API build.')));
  }
  const res = await api.post('/api/export/pptx', { views, filters });
  return res.data;
}
