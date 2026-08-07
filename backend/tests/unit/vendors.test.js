// Unit tests for UC-012 vendor account lifecycle (VND-T01 – VND-T06).
// Same mocked-supertest style as the notifications/analytics tests: supabase,
// db, cloudinary, and socket seams are mocked; no real network or DB.
'use strict';

process.env.CRON_SECRET = 'test-cron-secret';

const mockSignUp = jest.fn(async () => ({
  data: { user: { id: 'new-auth-1' } },
  error: null,
}));

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'admin-token') {
        return { data: { claims: { sub: 'adm-1', email: 'admin@example.com' } }, error: null };
      }
      if (token === 'manager-token') {
        return { data: { claims: { sub: 'mgr-1', email: 'mgr@example.com' } }, error: null };
      }
      if (token === 'suspended-token') {
        return { data: { claims: { sub: 'susp-1', email: 'susp@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
    signUp: mockSignUp,
  },
}));

jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(),
  uploadRaw: jest.fn(async () => 'https://res.cloudinary.com/test/contracts/doc.pdf'),
}));

jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

// Role/status profiles for requireRole; susp-1 is a suspended contractor.
const profiles = {
  'adm-1': { role: 'admin', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
  'susp-1': { role: 'contractor', status: 'suspended' },
};

// Full profile rows for userModel.findById (used by GET /users/me).
const profileRows = {
  'susp-1': { id: 'susp-1', email: 'susp@example.com', role: 'contractor', status: 'suspended' },
};

const mockQuery = jest.fn();

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: (...args) => mockQuery(...args),
}));

const request = require('supertest');
const app = require('../../src/app');
const { emitToRoom } = require('../../src/services/socketService');

// Default db.query behaviour; individual tests override specific patterns by
// mutating `state` below.
const state = {
  emailTaken: false,          // findByEmail result for the onboard login email
  vendorRow: null,            // contractorModel.findById result
  expiredRows: [],            // contractorModel.findExpired result
  userInsertFails: false,     // simulate a DB failure after the auth signUp
};

beforeEach(() => {
  jest.clearAllMocks();
  state.emailTaken = false;
  state.vendorRow = null;
  state.expiredRows = [];
  state.userInsertFails = false;

  mockQuery.mockImplementation(async (sql, params = []) => {
    if (/SELECT role, status FROM users/i.test(sql)) {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    }
    if (/SELECT \* FROM users WHERE email/i.test(sql)) {
      return { rows: state.emailTaken ? [{ id: 'existing-1', email: params[0] }] : [] };
    }
    if (/SELECT \* FROM users WHERE id/i.test(sql)) {
      const row = profileRows[params[0]];
      return { rows: row ? [row] : [] };
    }
    if (/UPDATE auth\.users SET email_confirmed_at/i.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO users/i.test(sql)) {
      if (state.userInsertFails) throw new Error('users insert failed (simulated)');
      return {
        rows: [{
          id: params[0], email: params[1], full_name: params[2], role: params[3],
          job_title: params[6], status: 'active',
        }],
      };
    }
    if (/INSERT INTO vendor_history/i.test(sql)) {
      return { rows: [{ id: 'vh-1', action: params[2], note: params[3] }] };
    }
    if (/FROM vendor_history/i.test(sql)) {
      return {
        rows: [{ id: 'vh-1', action: 'Onboarded', note: 'Contract …',
          actor_name: 'Admin One', created_at: '2026-07-17T00:00:00Z' }],
      };
    }
    if (/DELETE FROM auth\.users/i.test(sql)) {
      return { rows: [] };
    }
    if (/INSERT INTO contractors/i.test(sql)) {
      return {
        rows: [{
          id: 'ctr-1',
          name: params[0],
          user_id: params[3],
          contract_start: params[4],
          contract_end: params[5],
          contract_doc_url: params[6],
        }],
      };
    }
    if (/UPDATE users SET contractor_id/i.test(sql)) {
      return { rows: [{ id: params[0], contractor_id: params[1] }] };
    }
    if (/SELECT \* FROM contractors WHERE id/i.test(sql)) {
      return { rows: state.vendorRow ? [state.vendorRow] : [] };
    }
    if (/UPDATE contractors/i.test(sql)) {
      return { rows: [{ id: params[0], contract_end: params[1] }] };
    }
    if (/UPDATE users SET status/i.test(sql)) {
      return { rows: [{ id: params[0], status: params[1] }] };
    }
    if (/contract_end < CURRENT_DATE/i.test(sql)) {
      return { rows: state.expiredRows };
    }
    return { rows: [] };
  });
});

const validOnboard = {
  name: 'Otis Elevator Co.',
  contact_email: 'service@otis.example.com',
  brands_serviced: 'Otis',
  contract_start: '2026-07-01',
  contract_end: '2027-06-30',
  account_holder_name: 'Sing En',
  job_title: 'VP Operations',
  access_reason: 'Manages lift defect rectification under the 2026 contract',
  login_email: 'sing.en@otis.example.com',
  login_password: 'TempPass123',
};

function postOnboard(body, token = 'admin-token') {
  const req = request(app)
    .post('/api/admin/vendors')
    .set('Authorization', `Bearer ${token}`);
  // multer parses multipart — send every field as form-data like the real page.
  Object.entries(body).forEach(([k, v]) => req.field(k, v));
  return req;
}

describe('POST /api/admin/vendors (onboard)', () => {
  // VND-T01
  test('201 with valid data — contractors + users rows created, status active', async () => {
    const res = await postOnboard(validOnboard);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      contractor_id: 'ctr-1',
      user_id: 'new-auth-1',
      status: 'active',
      contract_end: '2027-06-30',
    });
    expect(mockSignUp).toHaveBeenCalledWith({
      email: validOnboard.login_email,
      password: validOnboard.login_password,
    });
  });

  // createVendor's params are (name, brands_serviced, contact_email, user_id, …)
  const insertParams = () =>
    mockQuery.mock.calls.find(([sql]) => /INSERT INTO contractors/i.test(sql))[1];

  // The onboarding form asks for neither field; both are server-filled.
  test('201 with neither inbox nor brands — both default off the other fields', async () => {
    const { contact_email: _e, brands_serviced: _b, ...minimal } = validOnboard;
    const res = await postOnboard(minimal);

    expect(res.status).toBe(201);
    // brands_serviced ← company name (the capability hint on the assign dropdown).
    expect(insertParams()[1]).toBe(validOnboard.name);
    // contact_email is NOT NULL and is the fallback recipient for defect mail
    // when the holder's login is suspended — it must never be written empty.
    expect(insertParams()[2]).toBe(validOnboard.login_email);
  });

  test('201 with both supplied — the given values are kept, not overwritten', async () => {
    const res = await postOnboard(validOnboard);

    expect(res.status).toBe(201);
    expect(insertParams()[1]).toBe('Otis');
    expect(insertParams()[2]).toBe('service@otis.example.com');
  });

  test('400 VALIDATION_ERROR when account-holder fields are missing', async () => {
    const { account_holder_name, job_title, access_reason, ...withoutHolder } = validOnboard;
    const res = await postOnboard(withoutHolder);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/account_holder_name.*job_title.*access_reason/);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  test('400 VALIDATION_ERROR for a malformed login email', async () => {
    const res = await postOnboard({ ...validOnboard, login_email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  // VND-T02
  test('400 INVALID_CONTRACT_DATES when contract_end < contract_start', async () => {
    const res = await postOnboard({ ...validOnboard, contract_end: '2026-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CONTRACT_DATES');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  // VND-T03
  test('409 EMAIL_ALREADY_EXISTS for a taken login email — no rows created', async () => {
    state.emailTaken = true;
    const res = await postOnboard(validOnboard);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  test('403 FORBIDDEN for a non-admin role', async () => {
    const res = await postOnboard(validOnboard, 'manager-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('onboard rollback + audit trail', () => {
  test('deletes the auth user when a DB step fails after signUp (no orphan)', async () => {
    state.userInsertFails = true;
    const res = await postOnboard(validOnboard);
    expect(res.status).toBe(500);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM auth\.users/i), ['new-auth-1']
    );
  });

  test('successful onboard writes an "Onboarded" history entry', async () => {
    await postOnboard(validOnboard);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO vendor_history/i),
      expect.arrayContaining(['ctr-1', 'adm-1', 'Onboarded'])
    );
  });
});

describe('PATCH /api/admin/vendors/:id (edit details)', () => {
  test('200 — updates contact/holder fields and records history', async () => {
    state.vendorRow = { id: 'ctr-1', name: 'Otis Elevator Co.', user_id: 'usr-1' };
    const res = await request(app)
      .patch('/api/admin/vendors/ctr-1')
      .set('Authorization', 'Bearer admin-token')
      .send({ job_title: 'Senior Operations Lead', contact_email: 'ops@otiselevator.sg' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contractor_id: 'ctr-1' });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO vendor_history/i),
      expect.arrayContaining(['ctr-1', 'adm-1', 'Details Updated'])
    );
  });

  test('400 when no fields are supplied', async () => {
    state.vendorRow = { id: 'ctr-1', name: 'Otis Elevator Co.', user_id: 'usr-1' };
    const res = await request(app)
      .patch('/api/admin/vendors/ctr-1')
      .set('Authorization', 'Bearer admin-token')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/vendors/:id/history', () => {
  test('200 — returns the audit trail with actor names', async () => {
    state.vendorRow = { id: 'ctr-1', name: 'Otis Elevator Co.', user_id: 'usr-1' };
    const res = await request(app)
      .get('/api/admin/vendors/ctr-1/history')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ action: 'Onboarded', actor_name: 'Admin One' });
  });
});

describe('GET /api/admin/vendors/expiry-check (daily job)', () => {
  // VND-T04
  test('suspends vendors past contract_end and notifies admin room', async () => {
    state.expiredRows = [{
      id: 'ctr-9', name: 'Expired Lifts Co.', contract_end: '2026-01-31', user_id: 'usr-9',
    }];
    const res = await request(app)
      .get('/api/admin/vendors/expiry-check')
      .set('Authorization', 'Bearer test-cron-secret');
    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(1);
    expect(res.body.vendors[0].contractor_id).toBe('ctr-9');
    // users.status flipped to suspended
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE users SET status/i),
      ['usr-9', 'suspended']
    );
    expect(emitToRoom).toHaveBeenCalledWith(
      'admin-room', 'vendor_expired', expect.objectContaining({ contractor_id: 'ctr-9' })
    );
  });

  test('admin can trigger the same check on demand via POST /run-expiry-check', async () => {
    state.expiredRows = [{
      id: 'ctr-9', name: 'Expired Lifts Co.', contract_end: '2026-01-31', user_id: 'usr-9',
    }];
    const res = await request(app)
      .post('/api/admin/vendors/run-expiry-check')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body.suspended).toBe(1);
  });

  test('non-admin cannot trigger the on-demand check', async () => {
    const res = await request(app)
      .post('/api/admin/vendors/run-expiry-check')
      .set('Authorization', 'Bearer manager-token');
    expect(res.status).toBe(403);
  });

  test('401 UNAUTHORIZED with a wrong cron secret', async () => {
    const res = await request(app)
      .get('/api/admin/vendors/expiry-check')
      .set('Authorization', 'Bearer wrong-secret');
    expect(res.status).toBe(401);
  });
});

describe('suspended vendor access (VND-T05)', () => {
  test('GET /api/users/me returns 403 ACCOUNT_SUSPENDED after login', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer suspended-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  test('role-gated routes stay 403 for suspended users', async () => {
    const res = await request(app)
      .get('/api/admin/vendors')
      .set('Authorization', 'Bearer suspended-token');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/vendors/:id/renew (VND-T06)', () => {
  test('200 — suspended vendor reactivated with new contract_end', async () => {
    state.vendorRow = {
      id: 'ctr-1', name: 'Otis Elevator Co.', user_id: 'usr-1',
      contract_start: '2026-07-01', contract_end: '2026-07-16',
    };
    const res = await request(app)
      .post('/api/admin/vendors/ctr-1/renew')
      .set('Authorization', 'Bearer admin-token')
      .send({ contract_end: '2028-06-30' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      contractor_id: 'ctr-1',
      status: 'active',
      contract_end: '2028-06-30',
    });
  });

  test('renew accepts an optional replacement contract document', async () => {
    state.vendorRow = {
      id: 'ctr-1', name: 'Otis Elevator Co.', user_id: 'usr-1',
      contract_start: '2026-07-01', contract_end: '2026-07-16',
    };
    const res = await request(app)
      .post('/api/admin/vendors/ctr-1/renew')
      .set('Authorization', 'Bearer admin-token')
      .field('contract_end', '2028-06-30')
      .attach('contract_doc', Buffer.from('%PDF-fake'), 'renewal.pdf');
    expect(res.status).toBe(200);
    const { uploadRaw } = require('../../src/services/cloudinaryService');
    expect(uploadRaw).toHaveBeenCalledWith(expect.any(Buffer), 'contracts', 'renewal.pdf');
    // updateContract received the new Cloudinary URL (not null)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE contractors/i),
      ['ctr-1', '2028-06-30', 'https://res.cloudinary.com/test/contracts/doc.pdf']
    );
  });

  test('404 for an unknown vendor id', async () => {
    const res = await request(app)
      .post('/api/admin/vendors/nope/renew')
      .set('Authorization', 'Bearer admin-token')
      .send({ contract_end: '2028-06-30' });
    expect(res.status).toBe(404);
  });

  // A renewal must EXTEND the contract. Comparing only against contract_start
  // used to let a direct API call silently shorten an active contract — the UI
  // disabled the button, but the server accepted it.
  test('400 INVALID_CONTRACT_DATES — a date on or before the current contract_end is not a renewal', async () => {
    state.vendorRow = {
      id: 'ctr-1', name: 'Otis Elevator Co.', user_id: 'usr-1',
      contract_start: '2026-01-01', contract_end: '2027-01-01',
    };
    for (const contract_end of ['2026-06-01', '2027-01-01']) {
      const res = await request(app)
        .post('/api/admin/vendors/ctr-1/renew')
        .set('Authorization', 'Bearer admin-token')
        .send({ contract_end });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_CONTRACT_DATES');
    }
  });
});

describe('POST /api/admin/vendors/:id/suspend (early termination)', () => {
  test('200 — linked account suspended immediately', async () => {
    state.vendorRow = { id: 'ctr-1', name: 'Otis Elevator Co.', user_id: 'usr-1' };
    const res = await request(app)
      .post('/api/admin/vendors/ctr-1/suspend')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contractor_id: 'ctr-1', status: 'suspended' });
  });
});
