// Mock dataset for the UC-005 dashboard — used only when USE_MOCK is true in
// services/analyticsService.js (demo without a running backend/database).
// Shapes mirror the real API responses exactly (HLD §6.3 / §6.4).

export const MOCK_SUMMARY = {
  open_count: 46,
  overdue_count: 4,
  avg_resolution_hours: 58.3,
  sla_percentage: 76.36,
  new_last_30: 58,
  new_prior_30: 41,
  new_records_change_pct: 41.5,
  sla_threshold_hrs: 72,
};

export const MOCK_HEATMAP = [
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

export const MOCK_TRENDS = [
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

export const MOCK_SLA = {
  compliant_count: 42,
  total_resolved: 55,
  sla_percentage: 76.36,
  sla_threshold_hrs: 72,
};

export const MOCK_SCORECARD = [
  { contractor: 'Otis Service SG', avg_rectification_days: 4.2, repeat_defect_rate: 8.5, overdue_count: 1, jobs: 14 },
  { contractor: 'Schindler Care', avg_rectification_days: 6.8, repeat_defect_rate: 15.0, overdue_count: 3, jobs: 9 },
  { contractor: 'KONE Maintenance', avg_rectification_days: 3.1, repeat_defect_rate: 4.2, overdue_count: 0, jobs: 11 },
];

export const MOCK_PRIORITY_QUEUE = [
  { id: 'INS-7f3a', title: 'Lift door misalignment at 44A-L1', block: '44A', category: 'Lift', priority: 'Critical', ai_priority_score: 88, status: 'Assigned', composite_score: 71.4, created_at: '2026-06-22T09:15:00Z' },
  { id: 'INS-2b9c', title: 'Water seepage at riser pipe L5', block: '88B', category: 'Plumbing', priority: 'High', ai_priority_score: 74, status: 'Open', composite_score: 63.8, created_at: '2026-06-23T14:02:00Z' },
  { id: 'INS-9k2m', title: 'Lift button panel unresponsive', block: '44B', category: 'Lift', priority: 'High', ai_priority_score: 72, status: 'Acknowledged', composite_score: 60.1, created_at: '2026-06-21T11:40:00Z' },
  { id: 'INS-5d1e', title: 'Corridor light flickering L12', block: '90C', category: 'Electrical', priority: 'Medium', ai_priority_score: 55, status: 'Open', composite_score: 47.9, created_at: '2026-06-24T08:30:00Z' },
  { id: 'INS-3a8f', title: 'Refuse chute jammed', block: '90C', category: 'Cleanliness', priority: 'Medium', ai_priority_score: 48, status: 'Assigned', composite_score: 41.2, created_at: '2026-06-20T16:55:00Z' },
];

export const MOCK_RECOMMENDATIONS = [
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
