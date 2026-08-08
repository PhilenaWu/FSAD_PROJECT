// Tests for the UC-012 data layer (services/vendorService.js).
//
// AdminVendorPage.test.jsx mocks this module, so the paths and the multipart
// bodies are asserted nowhere else. The renew call is the one with real logic:
// it builds the FormData the backend's multer handler reads.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import api from '../../../frontend/src/services/api';
import {
  listVendors,
  onboardVendor,
  renewVendor,
  suspendVendor,
  updateVendorDetails,
  getVendorHistory,
  runExpiryCheck,
} from '../../../frontend/src/services/vendorService';

vi.mock('../../../frontend/src/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const VENDOR_ID = '3f1c9a52-0b7e-4c26-9d5a-1e8f0b2c4d61';

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { data: [] } });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});

describe('vendorService — paths', () => {
  test('the list comes from the collection route', async () => {
    await listVendors();

    expect(api.get).toHaveBeenCalledWith('/api/admin/vendors');
  });

  test('suspend, history and edit address the vendor by id', async () => {
    await suspendVendor(VENDOR_ID);
    await getVendorHistory(VENDOR_ID);
    await updateVendorDetails(VENDOR_ID, { contact_person: 'Rachel Lim' });

    expect(api.post).toHaveBeenCalledWith(`/api/admin/vendors/${VENDOR_ID}/suspend`);
    expect(api.get).toHaveBeenCalledWith(`/api/admin/vendors/${VENDOR_ID}/history`);
    expect(api.patch).toHaveBeenCalledWith(`/api/admin/vendors/${VENDOR_ID}`, {
      contact_person: 'Rachel Lim',
    });
  });

  test('the on-demand expiry check posts to the admin route, not the cron one', async () => {
    // GET /expiry-check is cron-secret only and would 401 from the browser;
    // the page must use the POST twin.
    await runExpiryCheck();

    expect(api.post).toHaveBeenCalledWith('/api/admin/vendors/run-expiry-check');
    expect(api.get).not.toHaveBeenCalledWith('/api/admin/vendors/expiry-check');
  });

  test('onboarding posts the form data it was handed, untouched', async () => {
    const form = new FormData();
    form.append('name', 'Otis Service SG');

    await onboardVendor(form);

    expect(api.post).toHaveBeenCalledWith('/api/admin/vendors', form);
  });
});

describe('vendorService — renew builds the multipart body', () => {
  test('sends contract_end as FormData', async () => {
    await renewVendor(VENDOR_ID, '2027-12-31');

    const [path, body] = api.post.mock.calls[0];
    expect(path).toBe(`/api/admin/vendors/${VENDOR_ID}/renew`);
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('contract_end')).toBe('2027-12-31');
  });

  test('a replacement contract document is appended when one is given', async () => {
    const doc = new File(['contract'], 'contract-2027.pdf', { type: 'application/pdf' });

    await renewVendor(VENDOR_ID, '2027-12-31', doc);

    const [, body] = api.post.mock.calls[0];
    expect(body.get('contract_doc')).toBe(doc);
  });

  test('no document means no contract_doc field, so the stored one survives', async () => {
    // Appending an empty value would overwrite the vendor's existing contract
    // on the server with a blank upload.
    await renewVendor(VENDOR_ID, '2027-12-31');

    const [, body] = api.post.mock.calls[0];
    expect(body.has('contract_doc')).toBe(false);
  });
});
