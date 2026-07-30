// Unit tests for UC-010 contractor portal (Z.14): acknowledge sets status;
// rectify without a signature → 400 SIGNATURE_REQUIRED; hold pauses the
// deadline. Same mocked-supertest style as the notifications/vendors tests:
// supabase, db, cloudinary, and socket seams are mocked — no real network/DB.
'use strict';

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'contractor-token') {
        return { data: { claims: { sub: 'ctr-user-1', email: 'lc@example.com' } }, error: null };
      }
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(async () => 'https://res.cloudinary.com/test/signatures/sig.png'),
  uploadRaw: jest.fn(),
  uploadReport: jest.fn(),
}));

jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

// Contractor lifecycle mutations run in a transaction via pool.connect(); the
// portal reads happen on the shared query(). Both are mocked here.
const profiles = {
  'ctr-user-1': { role: 'contractor', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};

// The record the portal acts on; tests flip `assigned` to simulate a record
// reassigned away (UC-010 E3 → 404), and `lockedStatus` to drive the state the
// action starts from (resume requires 'On Hold').
const state = { assigned: true, lockedStatus: 'Assigned' };

const mockClient = {
  query: jest.fn(async (sql, params = []) => {
    if (/FOR UPDATE/i.test(sql)) {
      return state.assigned
        ? { rows: [{ id: 'ins-1', status: state.lockedStatus, location_block: '44A' }] }
        : { rows: [] };
    }
    // resumeByContractor reads the hold's start time from the audit trail.
    if (/FROM inspection_history/i.test(sql)) {
      return {
        rows: [{ previous_status: 'Acknowledged', created_at: '2026-07-22T09:00:00Z' }],
      };
    }
    if (/UPDATE inspections/i.test(sql)) {
      // Literal-status paths (acknowledge/finalize/hold) name the status inline;
      // the partial-save path parameterises it as `status = $2`.
      const status = /'Acknowledged'/.test(sql)
        ? 'Acknowledged'
        : /'Rectified'/.test(sql)
          ? 'Rectified'
          : /'On Hold'/.test(sql)
            ? 'On Hold'
            : params[1];
      return {
        rows: [{
          id: 'ins-1', status, location_block: '44A',
          acknowledged_at: '2026-07-27T09:00:00Z',
          rectified_at: '2026-07-27T15:00:00Z',
          hold_reason: 'part on order',
          updated_at: '2026-07-27T15:00:00Z',
        }],
      };
    }
    return { rows: [] };
  }),
  release: jest.fn(),
};

jest.mock('../../src/config/db', () => ({
  pool: { connect: jest.fn(async () => mockClient) },
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    if (/SELECT role, status FROM users/i.test(sql)) {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    }
    if (/FROM contractors WHERE user_id/i.test(sql)) {
      return { rows: [{ id: 'ctr-1', user_id: 'ctr-user-1', name: 'Otis' }] };
    }
    // signatureModel.create runs on the shared query() when no client passed —
    // but rectify passes the txn client, so this stays a catch-all.
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');
const { emitToRooms } = require('../../src/services/socketService');

beforeEach(() => {
  jest.clearAllMocks();
  state.assigned = true;
});

describe('POST /api/contractor/:id/acknowledge', () => {
  test('200 — sets status to Acknowledged and notifies the manager room', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/acknowledge')
      .set('Authorization', 'Bearer contractor-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'ins-1', status: 'Acknowledged' });
    expect(emitToRooms).toHaveBeenCalledWith(
      expect.arrayContaining(['manager-room']),
      'status_update',
      expect.objectContaining({ id: 'ins-1', status: 'Acknowledged' })
    );
  });

  test('404 when the record is no longer assigned to this contractor', async () => {
    state.assigned = false;
    const res = await request(app)
      .post('/api/contractor/ins-1/acknowledge')
      .set('Authorization', 'Bearer contractor-token');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('403 for a non-contractor role', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/acknowledge')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });

  test('401 without a token', async () => {
    const res = await request(app).post('/api/contractor/ins-1/acknowledge');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/contractor/:id/rectify', () => {
  test('400 SIGNATURE_REQUIRED when finalizing without a signature', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/rectify')
      .set('Authorization', 'Bearer contractor-token')
      .field('items', JSON.stringify([]));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SIGNATURE_REQUIRED');
  });

  test('200 finalize with a signature — status Rectified, signature stored', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/rectify')
      .set('Authorization', 'Bearer contractor-token')
      .field('items', JSON.stringify([]))
      .attach('signature', Buffer.from('fakepng'), 'sig.png');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'ins-1', status: 'Rectified', finalized: true, signature_stored: true,
    });
  });

  test('200 partial save (finalize=false) needs no signature — stays in progress', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/rectify')
      .set('Authorization', 'Bearer contractor-token')
      .field('finalize', 'false')
      .field('items', JSON.stringify([{ checklist_result_id: 'cr-1', rectified: true }]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'ins-1', status: 'Acknowledged', finalized: false, signature_stored: false,
    });
  });
});

describe('POST /api/contractor/:id/hold', () => {
  test('200 — sets status to On Hold with a reason (pauses the deadline)', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/hold')
      .set('Authorization', 'Bearer contractor-token')
      .send({ hold_reason: 'part on order' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'ins-1', status: 'On Hold' });
  });

  test('400 when no reason is supplied', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/hold')
      .set('Authorization', 'Bearer contractor-token')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// Z.2 / G11. Before this endpoint existed a held record had no way back —
// 'On Hold' was terminal and the paused deadline never restarted.
describe('POST /api/contractor/:id/resume', () => {
  afterEach(() => {
    state.lockedStatus = 'Assigned';
  });

  test('200 — restores the pre-hold status and extends the deadline', async () => {
    state.lockedStatus = 'On Hold';
    mockClient.query.mockClear();

    const res = await request(app)
      .post('/api/contractor/ins-1/resume')
      .set('Authorization', 'Bearer contractor-token');

    expect(res.status).toBe(200);
    // The audit row recorded 'Acknowledged' as the status before the pause, so
    // that is what the record goes back to — not a hardcoded 'Assigned'.
    expect(res.body).toMatchObject({ id: 'ins-1', status: 'Acknowledged' });

    // The deadline is pushed out by the held duration rather than reset.
    const [updateSql] = mockClient.query.mock.calls.find(([sql]) =>
      /UPDATE inspections/i.test(sql)
    );
    expect(updateSql).toMatch(/target_deadline \+ \(NOW\(\) -/i);

    // hold_reason is cleared so the inbox stops showing the banner.
    expect(updateSql).toMatch(/hold_reason = NULL/i);
  });

  test('writes a Resumed audit row (UC-015)', async () => {
    state.lockedStatus = 'On Hold';
    mockClient.query.mockClear();

    await request(app)
      .post('/api/contractor/ins-1/resume')
      .set('Authorization', 'Bearer contractor-token');

    const audit = mockClient.query.mock.calls.find(([sql]) =>
      /INSERT INTO inspection_history/i.test(sql)
    );
    expect(audit[0]).toMatch(/'Resumed'/);
    expect(audit[1][3]).toMatch(/deadline extended/i);
  });

  test('409 when the record is not on hold', async () => {
    state.lockedStatus = 'Assigned';
    const res = await request(app)
      .post('/api/contractor/ins-1/resume')
      .set('Authorization', 'Bearer contractor-token');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATE');
  });

  test('404 when the record is no longer this contractor\'s', async () => {
    state.lockedStatus = 'On Hold';
    state.assigned = false;
    const res = await request(app)
      .post('/api/contractor/ins-1/resume')
      .set('Authorization', 'Bearer contractor-token');
    state.assigned = true;

    expect(res.status).toBe(404);
  });
});
