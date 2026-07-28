// UC-007 CV data layer. Response shape follows GET /api/cv/detections
// exactly. Flip USE_MOCK to true to demo the manual review queue without a
// running backend/database — mock payload lives in mocks/cvMocks.js.
import api from './api';
import { MOCK_LOW_CONFIDENCE_DETECTIONS } from '../mocks/cvMocks';

const USE_MOCK = false;

const delay = (data) => new Promise((resolve) => setTimeout(() => resolve(data), 300));

// GET /api/cv/detections?status=low_confidence → { data: [...], total }
export async function getManualReviewQueue() {
  if (USE_MOCK) {
    return delay({ data: MOCK_LOW_CONFIDENCE_DETECTIONS, total: MOCK_LOW_CONFIDENCE_DETECTIONS.length });
  }
  const res = await api.get('/api/cv/detections', { params: { status: 'low_confidence' } });
  return res.data;
}

// POST /api/cv/detections/:id/create-ticket → the created inspection.
// location_block/location_unit are optional overrides — the backend falls
// back to whatever was captured with the detection when omitted.
export async function createTicketFromDetection(id, { category, priority, location_block, location_unit }) {
  if (USE_MOCK) {
    return delay({ id: `insp-mock-${id}`, source_type: 'cv_auto_detected', category, priority });
  }
  const res = await api.post(`/api/cv/detections/${id}/create-ticket`, {
    category,
    priority,
    location_block,
    location_unit,
  });
  return res.data;
}

// POST /api/cv/detections/:id/dismiss → the updated (dismissed) detection.
export async function dismissDetection(id) {
  if (USE_MOCK) {
    return delay({ id, status: 'dismissed' });
  }
  const res = await api.post(`/api/cv/detections/${id}/dismiss`);
  return res.data;
}
