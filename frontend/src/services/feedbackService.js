// General app feedback (sidebar "Feedback" form) API call. Thin wrapper over
// the shared axios instance, which attaches the Supabase bearer token.
import api from './api';

export function submitFeedback({ message, rating }) {
  return api.post('/api/feedback', { message, rating });
}
