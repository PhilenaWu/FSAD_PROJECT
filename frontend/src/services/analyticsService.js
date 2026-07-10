// UC-005 analytics data layer. Response shapes follow HIGH_LEVEL_DESIGN.md
// §6.3 (analytics) and §6.4 (recommendations) exactly, so flipping USE_MOCK to
// false swaps in the real backend without touching the dashboard components.
import api from './api';

// Live backend (analytics + recommendations list). Flip to true to demo the
// dashboard without a running backend/database.
const USE_MOCK = false;

// ---------------------------------------------------------------------------
// Mock dataset — a plausible month of estate records across 4 blocks.
// ---------------------------------------------------------------------------

const MOCK_HEATMAP = [
  { block: '44A', category: 'Lift', count: 9 },
  { block: '44A', category: 'Electrical', count: 3 },
  { block: '44A', category: 'Cleanliness', count: 2 },
  { block: '44B', category: 'Lift', count: 4 },
  { block: '44B', category: 'Plumbing', count: 6 },
  { block: '44B', category: 'Doors', count: 2 },
  { block: '88B', category: 'Plumbing', count: 7 },
  { block: '88B', category: 'Lift', count: 2 },
  { block: '88B', category: 'Safety', count: 1 },
  { block: '90C', category: 'Cleanliness', count: 5 },
  { block: '90C', category: 'Electrical', count: 4 },
  { block: '90C', category: 'Lift', count: 1 },
];

const MOCK_TRENDS = [
  { date: '2026-06-12', count: 2 },
  { date: '2026-06-13', count: 4 },
  { date: '2026-06-14', count: 3 },
  { date: '2026-06-15', count: 6 },
  { date: '2026-06-16', count: 5 },
  { date: '2026-06-17', count: 2 },
  { date: '2026-06-18', count: 7 },
  { date: '2026-06-19', count: 4 },
  { date: '2026-06-20', count: 3 },
  { date: '2026-06-21', count: 5 },
  { date: '2026-06-22', count: 8 },
  { date: '2026-06-23', count: 4 },
  { date: '2026-06-24', count: 6 },
  { date: '2026-06-25', count: 3 },
];

const MOCK_SLA = {
  compliant_count: 42,
  total_resolved: 55,
  sla_percentage: 76.36,
  sla_threshold_hrs: 72,
};

// Per phase task 5.2: avg rectification days, repeat-defect rate, overdue count.
const MOCK_SCORECARD = [
  { contractor: 'Otis Elevator Co.', avg_rectification_days: 4.2, repeat_defect_rate: 8.5, overdue_count: 1, jobs: 14 },
  { contractor: 'Schindler Lifts SG', avg_rectification_days: 6.8, repeat_defect_rate: 15.0, overdue_count: 3, jobs: 9 },
  { contractor: 'KONE Pte Ltd', avg_rectification_days: 3.1, repeat_defect_rate: 4.2, overdue_count: 0, jobs: 11 },
];

// Priority queue — composite score per phase task 5.3:
// (ai_priority_score × 0.5) + (recency_days × 0.3) + (frequency_score × 0.2)
const MOCK_PRIORITY_QUEUE = [
  { id: 'INS-7f3a', title: 'Lift door misalignment at 44A-L1', block: '44A', category: 'Lift', priority: 'Critical', ai_priority_score: 88, status: 'Assigned', composite_score: 71.4, created_at: '2026-06-22T09:15:00Z' },
  { id: 'INS-2b9c', title: 'Water seepage at riser pipe L5', block: '88B', category: 'Plumbing', priority: 'High', ai_priority_score: 74, status: 'Open', composite_score: 63.8, created_at: '2026-06-23T14:02:00Z' },
  { id: 'INS-9k2m', title: 'Lift button panel unresponsive', block: '44B', category: 'Lift', priority: 'High', ai_priority_score: 72, status: 'Acknowledged', composite_score: 60.1, created_at: '2026-06-21T11:40:00Z' },
  { id: 'INS-5d1e', title: 'Corridor light flickering L12', block: '90C', category: 'Electrical', priority: 'Medium', ai_priority_score: 55, status: 'Open', composite_score: 47.9, created_at: '2026-06-24T08:30:00Z' },
  { id: 'INS-3a8f', title: 'Refuse chute jammed', block: '90C', category: 'Cleanliness', priority: 'Medium', ai_priority_score: 48, status: 'Assigned', composite_score: 41.2, created_at: '2026-06-20T16:55:00Z' },
];

// AI risk alerts (ai_predictions) — cards show estimated cost per phase 5.13.
const MOCK_RECOMMENDATIONS = [
  {
    id: 'pred-abc123',
    location_block: '44A',
    category: 'Lift',
    velocity_pct: 60.0,
    estimated_cost: 800,
    alert_text:
      'Block 44A lift failures have increased 60% in 30 days. Recommend preventive inspection before end of month — est. $800 now vs $3,200 for reactive repair later.',
    status: 'Active',
    created_at: '2026-06-25T02:05:00Z',
  },
  {
    id: 'pred-def456',
    location_block: '88B',
    category: 'Plumbing',
    velocity_pct: 45.0,
    estimated_cost: 1200,
    alert_text:
      'Block 88B plumbing complaints up 45% vs prior period. Inspect riser pipes before wet season — projected cost impact $1,200.',
    status: 'Active',
    created_at: '2026-06-25T02:06:00Z',
  },
];

// Apply the ?block / ?category filters client-side so the filter controls are
// demonstrably live even in mock mode. Date filters are accepted but not
// applied to the static mock set.
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

// Priority queue (part of GET /api/inspections ordering per HLD; served as
// mock rows here until the backend query lands).
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

// POST /api/export/pptx → { pptx_url } (HLD §6.11). No mock deck — surfaces a
// clear "not built yet" error until the backend export route exists.
export async function exportPptx(views, filters) {
  if (USE_MOCK) {
    return delay(Promise.reject(new Error('PowerPoint export needs the backend — coming with the API build.')));
  }
  const res = await api.post('/api/export/pptx', { views, filters });
  return res.data;
}
