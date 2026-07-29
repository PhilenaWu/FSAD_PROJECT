// UC-005 analytics data layer. Response shapes follow HIGH_LEVEL_DESIGN.md
// §6.3 (analytics) and §6.4 (recommendations) exactly. Every call goes to the
// live backend — the dashboard has no offline data source.
import api from './api';

// SLA resolution target — mirror of the backend's SLA_THRESHOLD_HRS
// (backend/src/controllers/analyticsController.js). Keep the two in sync.
export const SLA_THRESHOLD_HRS = 72;

// ---------------------------------------------------------------------------
// Public API — each mirrors one backend endpoint.
// ---------------------------------------------------------------------------

// GET /api/analytics/filter-options → { blocks: [...], categories: [...] }
// Dropdown options come from the data itself — nothing hardcoded.
export async function getFilterOptions() {
  const res = await api.get('/api/analytics/filter-options');
  return res.data;
}

// GET /api/analytics/summary → KPI tiles with vs-prior-30-days movement
export async function getSummary(filters = {}) {
  const res = await api.get('/api/analytics/summary', { params: filters });
  return res.data;
}

// GET /api/analytics/issues-by-block → { data: [{ block, category, count }] }
export async function getHeatmap(filters = {}) {
  const res = await api.get('/api/analytics/issues-by-block', { params: filters });
  return res.data;
}

// GET /api/analytics/trends → { data: [{ date, count }] }
export async function getTrends(filters = {}) {
  const res = await api.get('/api/analytics/trends', { params: filters });
  return res.data;
}

// GET /api/analytics/sla-compliance → { compliant_count, total_resolved, sla_percentage, sla_threshold_hrs }
export async function getSlaCompliance(filters = {}) {
  const res = await api.get('/api/analytics/sla-compliance', { params: filters });
  return res.data;
}

// GET /api/analytics/contractor-scorecard → { data: [...] }
export async function getContractorScorecard(filters = {}) {
  const res = await api.get('/api/analytics/contractor-scorecard', { params: filters });
  return res.data;
}

// GET /api/analytics/priority-queue → { data: [...] }
export async function getPriorityQueue(filters = {}) {
  const res = await api.get('/api/analytics/priority-queue', { params: filters });
  return res.data;
}

// GET /api/recommendations?status=Active → { data: [...], total } (HLD §6.4)
export async function getRecommendations() {
  const res = await api.get('/api/recommendations', { params: { status: 'Active' } });
  return res.data;
}

// POST /api/recommendations/:id/accept
export async function acceptRecommendation(id) {
  const res = await api.post(`/api/recommendations/${id}/accept`);
  return res.data;
}

// POST /api/recommendations/:id/dismiss
export async function dismissRecommendation(id) {
  const res = await api.post(`/api/recommendations/${id}/dismiss`);
  return res.data;
}

// GET /api/recommendations/run — nightly analysis, also manager-triggerable.
// Callers handle a failure with a toast.
export async function runAnalysis() {
  const res = await api.get('/api/recommendations/run');
  return res.data;
}

// POST /api/export/pptx → { pptx_url } (HLD §6.11)
export async function exportPptx(views, filters) {
  const res = await api.post('/api/export/pptx', { views, filters });
  return res.data;
}
