// UC-008 notification API calls. Thin wrappers over the shared axios instance,
// which attaches the Supabase bearer token.
import api from './api';

// Manager sends or schedules a notification. `send_time` null/omitted = now.
export function send({ message, scope, urgency, send_time }) {
  return api.post('/api/notifications', { message, scope, urgency, send_time });
}

// Manager polls read/unread counts for one notification.
export function getReceipts(id) {
  return api.get(`/api/notifications/${id}/receipts`);
}

// The caller's own persisted inbox — what the bell loads on mount so messages
// received while offline (or before a refresh) are not lost.
export function list({ unread_only = false, limit } = {}) {
  const params = {};
  if (unread_only) params.unread_only = 'true';
  if (limit) params.limit = limit;
  return api.get('/api/notifications', { params });
}

// Recipient marks a notification read.
export function markRead(id) {
  return api.patch(`/api/notifications/${id}/read`);
}
