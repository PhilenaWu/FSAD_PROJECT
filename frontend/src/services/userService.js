// Resident registration + the manager approval queue. Thin wrappers over the
// shared axios instance, which attaches the Supabase bearer token.
import api from './api';

// Creates the caller's own profile row as a pending resident. role and status
// are set server-side and are not sent from here.
export function registerProfile({ full_name, block_number, unit_number }) {
  return api.post('/api/users/register-profile', {
    full_name,
    block_number,
    unit_number,
  });
}

export function listPendingResidents() {
  return api.get('/api/users/pending-residents');
}

export function approveResident(id) {
  return api.post(`/api/users/pending-residents/${id}/approve`);
}

export function rejectResident(id) {
  return api.post(`/api/users/pending-residents/${id}/reject`);
}
