// Contractor portal API calls (UC-010). Thin wrappers over the axios instance,
// which attaches the Supabase bearer token. The backend gates every route to
// the `contractor` role and to the caller's own assigned records.
import api from './api';

// GET the contractor's assigned-defects inbox (records + defect checklist items
// + days_remaining). Returns the array from the { data } envelope.
export async function getAssigned() {
  const res = await api.get('/api/contractor/assigned');
  return res.data.data;
}

// Acknowledge a defect → status Acknowledged.
export function acknowledge(id) {
  return api.post(`/api/contractor/${id}/acknowledge`);
}

// Submit completed work: `formData` carries the items JSON, per-item completion
// photos (photo_<checklist_result_id>), the signature PNG, and an optional
// overall remark. Axios sets the multipart boundary from the FormData.
export function rectify(id, formData) {
  return api.post(`/api/contractor/${id}/rectify`, formData);
}

// Put a defect on hold with a reason (Alt Flow A) — pauses the deadline.
export function hold(id, hold_reason) {
  return api.post(`/api/contractor/${id}/hold`, { hold_reason });
}
