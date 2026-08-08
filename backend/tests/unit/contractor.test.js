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
// `heldAction` is the latest 'On Hold'/'Resumed' audit row, which is what
// "currently held" means now that a hold is not a status.
const state = { assigned: true, lockedStatus: 'Assigned', heldAction: null, inspectorId: 'insp-1' };

const mockClient = {
  query: jest.fn(async (sql, params = []) => {
    if (/FOR UPDATE/i.test(sql)) {
      return state.assigned
        ? { rows: [{ id: 'ins-1', status: state.lockedStatus, location_block: '44A' }] }
        : { rows: [] };
    }
    // resumeByContractor reads the latest hold/resume row: its action decides
    // whether the record is currently held, its created_at when the pause began.
    if (/FROM inspection_history/i.test(sql)) {
      return {
        rows: state.heldAction
          ? [{ action: state.heldAction, created_at: '2026-07-22T09:00:00Z' }]
          : [],
      };
    }
    if (/UPDATE inspections/i.test(sql)) {
      // Only finalising names a status inline now — acknowledging and holding
      // leave the status alone and record themselves in the audit trail.
      const status = /'Rectified'/.test(sql) ? 'Rectified' : state.lockedStatus;
      return {
        rows: [{
          id: 'ins-1', status, location_block: '44A',
          title: 'Lift door defect',
          // The record's own inspector, if it has one. A resident complaint
          // assigned straight to a contractor has none.
          inspector_id: state.inspectorId,
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
    // Notification delivery: the row insert, then recipient resolution. Without
    // these notifyEvent swallows its own failure (G13) and never reaches the
    // socket, so the item 17 assertions below would have nothing to see.
    if (/INSERT INTO notifications/i.test(sql)) {
      // Mirrors the RETURNING * of the real insert; `scope` matters most —
      // deliver() resolves recipients straight off the returned row.
      return {
        rows: [{
          id: 'notif-1',
          manager_id: params[0],
          message: params[1],
          scope: params[2],
          urgency: params[3],
          event_type: params[7],
          link: params[8],
        }],
      };
    }
    if (/SELECT id FROM users/i.test(sql)) {
      return { rows: [{ id: 'mgr-1' }] };
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
  state.lockedStatus = 'Assigned';
  state.heldAction = null;
  state.inspectorId = 'insp-1';
});

describe('POST /api/contractor/:id/acknowledge', () => {
  // Accepting a job no longer moves the status — the record stays 'Assigned'
  // and the acceptance lives in acknowledged_at plus the audit trail.
  test('200 — records the acceptance and notifies the manager room', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/acknowledge')
      .set('Authorization', 'Bearer contractor-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'ins-1', status: 'Assigned' });
    expect(emitToRooms).toHaveBeenCalledWith(
      expect.arrayContaining(['manager-room']),
      'status_update',
      expect.objectContaining({ id: 'ins-1', status: 'Assigned' })
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

  // Item 17 — finishing the work is what raises the inspector's task. The
  // record reaches their Rectified queue on its own; this is the nudge that
  // tells them it is theirs to check.
  test('finalize notifies the managers and tasks the record inspector', async () => {
    emitToRooms.mockClear();

    await request(app)
      .post('/api/contractor/ins-1/rectify')
      .set('Authorization', 'Bearer contractor-token')
      .field('items', JSON.stringify([]))
      .attach('signature', Buffer.from('fakepng'), 'sig.png');

    const notifications = emitToRooms.mock.calls.filter(([, event]) => event === 'notification');
    expect(notifications).toHaveLength(2);

    const [managerRooms, , managerPayload] = notifications[0];
    expect(managerRooms).toEqual(['manager-room']);
    expect(managerPayload.event_type).toBe('rectified');

    const [inspectorRooms, , inspectorPayload] = notifications[1];
    expect(inspectorRooms).toEqual(['inspector-team']);
    expect(inspectorPayload.event_type).toBe('review_requested');
    expect(inspectorPayload.message).toMatch(/check the work/i);

    // Disjoint audiences — the point of two rows rather than one (D.12).
    expect(managerRooms).not.toContain('inspector-team');
  });

  // The queue an inspector actually sees lists every record awaiting a check,
  // whoever filed it — so the task goes to the whole team. Addressing only the
  // record's own inspector meant a resident complaint assigned to a contractor,
  // which has none, landed in that queue with nobody told.
  test('finalize tasks the inspectors even when the record has no inspector', async () => {
    emitToRooms.mockClear();
    state.inspectorId = null;

    await request(app)
      .post('/api/contractor/ins-1/rectify')
      .set('Authorization', 'Bearer contractor-token')
      .field('items', JSON.stringify([]))
      .attach('signature', Buffer.from('fakepng'), 'sig.png');

    const notifications = emitToRooms.mock.calls.filter(([, event]) => event === 'notification');
    expect(notifications).toHaveLength(2);
    const [inspectorRooms, , inspectorPayload] = notifications[1];
    expect(inspectorRooms).toEqual(['inspector-team']);
    expect(inspectorPayload.event_type).toBe('review_requested');
  });

  test('a partial save raises no notification at all', async () => {
    emitToRooms.mockClear();

    await request(app)
      .post('/api/contractor/ins-1/rectify')
      .set('Authorization', 'Bearer contractor-token')
      .field('finalize', 'false')
      .field('items', JSON.stringify([]));

    expect(
      emitToRooms.mock.calls.filter(([, event]) => event === 'notification')
    ).toHaveLength(0);
  });

  test('200 partial save (finalize=false) needs no signature — stays in progress', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/rectify')
      .set('Authorization', 'Bearer contractor-token')
      .field('finalize', 'false')
      .field('items', JSON.stringify([{ checklist_result_id: 'cr-1', rectified: true }]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'ins-1', status: 'Assigned', finalized: false, signature_stored: false,
    });
  });
});

describe('POST /api/contractor/:id/hold', () => {
  // A hold records a reason and pauses the deadline; the status stays 'Assigned'.
  test('200 — records the hold reason (pauses the deadline)', async () => {
    const res = await request(app)
      .post('/api/contractor/ins-1/hold')
      .set('Authorization', 'Bearer contractor-token')
      .send({ hold_reason: 'part on order' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'ins-1', status: 'Assigned', hold_reason: 'part on order' });
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

// Z.2 / G11. Before this endpoint existed a held record had no way back — the
// paused deadline never restarted. "Held" is the latest 'On Hold'/'Resumed'
// audit row now, not a status, so these drive state.heldAction.
describe('POST /api/contractor/:id/resume', () => {
  test('200 — clears the hold and extends the deadline', async () => {
    state.heldAction = 'On Hold';
    mockClient.query.mockClear();

    const res = await request(app)
      .post('/api/contractor/ins-1/resume')
      .set('Authorization', 'Bearer contractor-token');

    expect(res.status).toBe(200);
    // Nothing to restore — the record never left 'Assigned'.
    expect(res.body).toMatchObject({ id: 'ins-1', status: 'Assigned' });

    // The deadline is pushed out by the held duration rather than reset.
    const [updateSql] = mockClient.query.mock.calls.find(([sql]) =>
      /UPDATE inspections/i.test(sql)
    );
    expect(updateSql).toMatch(/target_deadline \+ \(NOW\(\) -/i);

    // hold_reason is cleared so the inbox stops showing the banner.
    expect(updateSql).toMatch(/hold_reason = NULL/i);
  });

  test('writes a Resumed audit row (UC-015)', async () => {
    state.heldAction = 'On Hold';
    mockClient.query.mockClear();

    await request(app)
      .post('/api/contractor/ins-1/resume')
      .set('Authorization', 'Bearer contractor-token');

    const audit = mockClient.query.mock.calls.find(([sql]) =>
      /INSERT INTO inspection_history/i.test(sql)
    );
    expect(audit[1][2]).toBe('Resumed');
    expect(audit[1][5]).toMatch(/deadline extended/i);
  });

  test('409 when the record is not on hold', async () => {
    state.heldAction = null;
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
