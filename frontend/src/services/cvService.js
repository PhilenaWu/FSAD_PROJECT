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
