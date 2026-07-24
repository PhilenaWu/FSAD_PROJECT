// UC-009 automated reports data layer. Thin wrappers over the two manager-facing
// report endpoints; the shared `api` instance attaches the Supabase Bearer token
// and the backend enforces the manager/admin role.
import api from './api';

// GET /api/reports → { data: [...reports], total }
// Each report row: { id, report_url, period_start, period_end, generated_at,
// triggered_by, report_status, email_delivered }.
export async function getReports() {
  const res = await api.get('/api/reports');
  return res.data;
}

// POST /api/reports/generate-manual → { data: <report row> }
// `data` may carry { startDate, endDate }; omit it to let the backend default to
// the current month to date.
export async function generateManualReport(data = {}) {
  const res = await api.post('/api/reports/generate-manual', data);
  return res.data;
}
