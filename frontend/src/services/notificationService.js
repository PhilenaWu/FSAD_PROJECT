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

// Recipient marks a notification read.
export function markRead(id) {
  return api.patch(`/api/notifications/${id}/read`);
}
