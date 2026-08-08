// Integration tests for UC-003 "my reports" — GET /api/my-reports/history (the
// originator's closed records), GET /api/my-reports/:id (own detail + audit
// history + checklist results) and POST /api/my-reports/:id/rating. The app runs
// in-process (supertest); the Supabase auth and pg boundaries are mocked so the
// real route/controller/model flow is exercised without a network or database.
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      const subs = {
        'resident-token': 'res-1',
        'other-resident-token': 'res-2',
        'inspector-token': 'ins-1',
        'manager-token': 'mgr-1',
      };
      if (subs[token]) {
        return { data: { claims: { sub: subs[token], email: `${subs[token]}@example.com` } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: modules app.js loads at require time that we never exercise here. ---
jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(async () => 'https://cloudinary.test/defects/mock.png'),
}));
// Every export routes/cv.js registers must be present: Express throws
// "argument handler must be a function" at require time on an undefined handler,
// which fails the whole suite before a single test runs. This page never calls
// CV, so the bodies only need to exist.
jest.mock('../../src/controllers/cvController', () => ({
  detect: jest.fn(async () => ({ cvDetection: null, inspection: null })),
  batchScan: jest.fn(async () => ({ processed: 0, failed: 0, remaining: 0 })),
  listDetections: jest.fn((req, res) => res.json({ data: [], total: 0 })),
  createTicketFromDetection: jest.fn((req, res) => res.status(201).json({})),
  dismissDetection: jest.fn((req, res) => res.json({})),
}));
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

// --- Mock: the pg layer. Just the tables these two endpoints touch. ---
const profiles = {
  'res-1': { role: 'resident', status: 'active' },
  'res-2': { role: 'resident', status: 'active' },
  'ins-1': { role: 'inspector', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
};

let inspections;
let history;
let checklistResults;

function resetStore() {
  inspections = [
    // res-1's complaint, resolved and unrated — the ratable one.
    {
      id: 'insp-1',
      source_type: 'resident_complaint',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Lift button broken at Level 3',
      description: 'Button 3 does not respond',
      location_block: '44A',
      status: 'Resolved',
      category: 'Lift',
      satisfaction_rating: null,
      satisfaction_comment: null,
      is_deleted: false,
      created_at: '2026-07-01T09:15:00Z',
    },
    // res-1's complaint, still being worked — not ratable yet.
    {
      id: 'insp-2',
      source_type: 'resident_complaint',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Corridor light flickering',
      location_block: '44A',
      status: 'Assigned',
      category: 'Electrical',
      satisfaction_rating: null,
      is_deleted: false,
      created_at: '2026-07-10T09:15:00Z',
    },
    // res-1's complaint, already rated.
    {
      id: 'insp-3',
      source_type: 'resident_complaint',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Bin chute jammed',
      location_block: '44A',
      status: 'Resolved',
      category: 'Cleanliness',
      satisfaction_rating: 4,
      satisfaction_comment: 'Quick fix',
      is_deleted: false,
      created_at: '2026-06-20T09:15:00Z',
    },
    // ins-1's lift spot-check, with checklist results.
    {
      id: 'insp-4',
      source_type: 'lift_inspection',
      resident_id: null,
      inspector_id: 'ins-1',
      title: 'Spot-check 44A-L1',
      location_block: '44A',
      status: 'Assigned',
      category: 'Miscellaneous',
      satisfaction_rating: null,
      is_deleted: false,
      created_at: '2026-07-12T09:15:00Z',
    },
    // Closed and archived, never rated — the case the history view exists for:
    // the workflow closes records without passing through 'Resolved', so this is
    // the resident's only chance to rate it.
    {
      id: 'insp-5',
      source_type: 'resident_complaint',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Old complaint',
      location_block: '44A',
      status: 'Closed',
      category: 'Lift',
      satisfaction_rating: null,
      is_deleted: true,
      created_at: '2026-05-01T09:15:00Z',
      closed_at: '2026-05-09T09:15:00Z',
    },
    // Another resident's closed record — must never appear in res-1's history.
    {
      id: 'insp-6',
      source_type: 'resident_complaint',
      resident_id: 'res-2',
      inspector_id: null,
      title: "Someone else's closed complaint",
      location_block: '44A',
      status: 'Closed',
      category: 'Lift',
      satisfaction_rating: null,
      is_deleted: true,
      created_at: '2026-05-02T09:15:00Z',
      closed_at: '2026-05-10T09:15:00Z',
    },
  ];
  history = [
    {
      inspection_id: 'insp-1',
      actor_id: 'mgr-1',
      action: 'Assigned',
      previous_status: 'Open',
      new_status: 'Assigned',
      note: 'Sent to lift contractor',
      created_at: '2026-07-02T11:00:00Z',
    },
  ];
  checklistResults = [
    {
      id: 'chk-1',
      inspection_id: 'insp-4',
      result: 'Defect',
      severity: 'Major',
      remark: 'Door catches on the sill',
      section: 'B — Lift Car',
      item_text: 'Door side gaps — Less than 10mm?',
      display_order: 5,
    },
  ];
}

const mockQuery = jest.fn(async (sql, params = []) => {
  // requireRole: SELECT role, status FROM users WHERE id = $1
  if (/FROM users WHERE id/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // submitRating: UPDATE inspections SET satisfaction_rating = ...
  if (/UPDATE inspections/i.test(sql) && /satisfaction_rating/i.test(sql)) {
    const [id, residentId, rating, comment] = params;
    const row = inspections.find((i) => i.id === id && i.resident_id === residentId);
    if (!row) return { rows: [] };
    row.satisfaction_rating = rating;
    row.satisfaction_comment = comment ?? null;
    return { rows: [{ ...row }] };
  }
  // findOwnArchived: WHERE (resident_id = $1 OR inspector_id = $1) AND is_deleted = TRUE
  if (/FROM inspections/i.test(sql) && /resident_id = \$1 OR inspector_id = \$1/i.test(sql)) {
    const [userId] = params;
    const rows = inspections
      .filter((i) => i.is_deleted && (i.resident_id === userId || i.inspector_id === userId))
      .sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''));
    return { rows: rows.map((r) => ({ ...r })) };
  }
  // findOwnRecord: WHERE id = $1 AND (resident_id = $2 OR inspector_id = $2).
  // No is_deleted filter — closed records stay readable in the originator's
  // history so they can still be rated.
  if (/FROM inspections/i.test(sql) && /resident_id = \$2 OR inspector_id = \$2/i.test(sql)) {
    const [id, userId] = params;
    const row = inspections.find(
      (i) => i.id === id && (i.resident_id === userId || i.inspector_id === userId)
    );
    return { rows: row ? [{ ...row }] : [] };
  }
  // findOwnDetail history: SELECT ... FROM inspection_history h LEFT JOIN users
  if (/FROM inspection_history/i.test(sql)) {
    const rows = history
      .filter((h) => h.inspection_id === params[0])
      .map((h) => ({ ...h, actor_name: h.actor_id === 'mgr-1' ? 'Mdm Tan' : null }));
    return { rows };
  }
  // findOwnDetail checklist: SELECT ... FROM checklist_results r JOIN checklist_items c
  if (/FROM checklist_results/i.test(sql)) {
    return { rows: checklistResults.filter((c) => c.inspection_id === params[0]) };
  }
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  query: (...args) => mockQuery(...args),
  pool: { connect: jest.fn() },
}));

const request = require('supertest');
const app = require('../../src/app');

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  resetStore();
  mockQuery.mockClear();
});

describe('GET /api/my-reports/history', () => {
  it("returns only the caller's own closed records, most recently closed first", async () => {
    const res = await request(app).get('/api/my-reports/history').set(auth('resident-token'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.id)).toEqual(['insp-5']);
  });

  it('excludes live records — those belong to the active list', async () => {
    const res = await request(app).get('/api/my-reports/history').set(auth('resident-token'));

    expect(res.body.data.every((r) => r.is_deleted)).toBe(true);
  });

  it('is empty for an originator with nothing closed', async () => {
    const res = await request(app).get('/api/my-reports/history').set(auth('inspector-token'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('403s for a manager', async () => {
    const res = await request(app).get('/api/my-reports/history').set(auth('manager-token'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/my-reports/:id', () => {
  it('returns the record with its audit history for the resident who filed it', async () => {
    const res = await request(app).get('/api/my-reports/insp-1').set(auth('resident-token'));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('insp-1');
    expect(res.body.description).toBe('Button 3 does not respond');
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ action: 'Assigned', actor_name: 'Mdm Tan' });
  });

  it('returns the checklist results for the inspector who performed the spot-check', async () => {
    const res = await request(app).get('/api/my-reports/insp-4').set(auth('inspector-token'));

    expect(res.status).toBe(200);
    expect(res.body.checklist_results).toHaveLength(1);
    expect(res.body.checklist_results[0]).toMatchObject({
      section: 'B — Lift Car',
      severity: 'Major',
    });
  });

  it("404s on another resident's record rather than 403 — no existence leak", async () => {
    const res = await request(app).get('/api/my-reports/insp-1').set(auth('other-resident-token'));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('still serves a closed record to its originator, for the history view', async () => {
    const res = await request(app).get('/api/my-reports/insp-5').set(auth('resident-token'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'insp-5', status: 'Closed', is_deleted: true });
  });

  it('404s on a record id that does not exist', async () => {
    const res = await request(app).get('/api/my-reports/insp-999').set(auth('resident-token'));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('403s for a manager — this route is the originator view', async () => {
    const res = await request(app).get('/api/my-reports/insp-1').set(auth('manager-token'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('401s without a token', async () => {
    const res = await request(app).get('/api/my-reports/insp-1');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/my-reports/:id/rating', () => {
  it('stores a rating and comment on a resolved complaint', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-1/rating')
      .set(auth('resident-token'))
      .send({ rating: 4, comment: 'Fixed quickly, thank you!' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'insp-1',
      satisfaction_rating: 4,
      satisfaction_comment: 'Fixed quickly, thank you!',
    });
    expect(inspections.find((i) => i.id === 'insp-1').satisfaction_rating).toBe(4);
  });

  it('accepts a rating without a comment', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-1/rating')
      .set(auth('resident-token'))
      .send({ rating: 5 });

    expect(res.status).toBe(200);
    expect(res.body.satisfaction_comment).toBeNull();
  });

  it('409s ALREADY_RATED on a second submission', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-3/rating')
      .set(auth('resident-token'))
      .send({ rating: 2 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_RATED');
    // The original rating is untouched.
    expect(inspections.find((i) => i.id === 'insp-3').satisfaction_rating).toBe(4);
  });

  it('accepts a rating on a closed record — the workflow closes without passing through Resolved', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-5/rating')
      .set(auth('resident-token'))
      .send({ rating: 3, comment: 'Took a while but sorted' });

    expect(res.status).toBe(200);
    expect(res.body.satisfaction_rating).toBe(3);
    expect(inspections.find((i) => i.id === 'insp-5').satisfaction_rating).toBe(3);
  });

  it('409s INVALID_STATE when the work is not resolved yet', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-2/rating')
      .set(auth('resident-token'))
      .send({ rating: 3 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATE');
  });

  it('400s on an out-of-range rating', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-1/rating')
      .set(auth('resident-token'))
      .send({ rating: 7 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400s on a non-integer rating', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-1/rating')
      .set(auth('resident-token'))
      .send({ rating: 4.5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it("404s when rating another resident's closed record", async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-6/rating')
      .set(auth('resident-token'))
      .send({ rating: 1 });

    expect(res.status).toBe(404);
    expect(inspections.find((i) => i.id === 'insp-6').satisfaction_rating).toBeNull();
  });

  it("404s when rating another resident's record", async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-1/rating')
      .set(auth('other-resident-token'))
      .send({ rating: 5 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('403s for a manager', async () => {
    const res = await request(app)
      .post('/api/my-reports/insp-1/rating')
      .set(auth('manager-token'))
      .send({ rating: 5 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
