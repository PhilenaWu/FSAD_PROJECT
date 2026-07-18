// UC-012 vendor lifecycle API calls (admin only).
import api from './api';

// List all vendors with contract status, soonest-expiring first.
export function listVendors() {
  return api.get('/api/admin/vendors');
}

// Onboard a new vendor. `formData` is multipart (fields + optional contract_doc).
export function onboardVendor(formData) {
  return api.post('/api/admin/vendors', formData);
}

// Extend a vendor's contract; reactivates a suspended account. Optional new
// contract document replaces the stored one (multipart when a file is given).
export function renewVendor(id, contractEnd, contractDoc) {
  const data = new FormData();
  data.append('contract_end', contractEnd);
  if (contractDoc) data.append('contract_doc', contractDoc);
  return api.post(`/api/admin/vendors/${id}/renew`, data);
}

// Early termination — suspends the vendor's login immediately.
export function suspendVendor(id) {
  return api.post(`/api/admin/vendors/${id}/suspend`);
}

// Edit non-contract details (contact/brands/holder/reason). Only sent fields change.
export function updateVendorDetails(id, fields) {
  return api.patch(`/api/admin/vendors/${id}`, fields);
}

// Full audit trail for one vendor (onboarded/renewed/suspended/…).
export function getVendorHistory(id) {
  return api.get(`/api/admin/vendors/${id}/history`);
}

// Run the contract expiry check on demand (same logic as the nightly job).
export function runExpiryCheck() {
  return api.post('/api/admin/vendors/run-expiry-check');
}
