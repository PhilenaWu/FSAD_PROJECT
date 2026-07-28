// Integration tests for inspections — POST /api/inspections (UC-001 resident
// complaint) and POST /api/inspections/lift (UC-001 inspector lift spot-check).
// The app runs in-process (supertest). Boundaries are mocked so the test is
// deterministic and hits no network:
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:        in-memory store so we exercise the real controller/model
//                       flow without a Postgres/Supabase connection
//   - cloudinaryService: fake uploadImage (no upload)
//   - cvController:     fake detect (no Roboflow call)
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      if (token === 'manager-token') {
        return { data: { claims: { sub: 'mgr-1', email: 'mgr@example.com' } }, error: null };
      }
      if (token === 'inspector-token') {
        return { data: { claims: { sub: 'ins-1', email: 'ins@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: Cloudinary upload. Returns a fixed URL, no network. ---
jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(async () => 'https://cloudinary.test/defects/mock.png'),
}));

// --- Mock: CV detection. detect() is fired fire-and-forget by the controller
// (its resolved value isn't used), so a resolved no-op is enough. batchScan/
// listDetections aren't exercised here but must exist as functions — app.js
// requires this module at load time and cv.js passes listDetections directly
// as a route handler, so an undefined export would blow up require(). No
// Roboflow call happens, and no extra cv_auto_detected row lands in the
// in-memory store.
jest.mock('../../src/controllers/cvController', () => ({
  detect: jest.fn(async () => ({ cvDetection: { id: 'cv-mock-1', status: 'low_confidence' }, inspection: null })),
  batchScan: jest.fn(async () => ({ processed: 0, failed: 0, remaining: 0 })),
  listDetections: jest.fn((req, res) => res.json({ data: [], total: 0 })),
}));

// --- Mock: Socket.IO emit seam (no server in tests). ---
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

// --- Mock: the pg layer. A tiny in-memory model of the tables we touch. ---
const profiles = {
  'res-1': { role: 'resident', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
  'ins-1': { role: 'inspector', status: 'active' },
};
const lifts = {
  'lift-1': {
    id: 'lift-1',
    block_number: '44A',
    lift_code: '44A-L1',
    brand: 'Otis',
    contractor_id: 'con-1',
    contractor_name: 'Otis Service SG',
  },
};
// Deliberately unordered + one inactive item, so the ORDER BY / active filter
// in checklistItemModel.findActive is actually exercised.
const checklistItems = [
  { id: 'item-2', section: 'Doors', item_text: 'Door sensor reopens', display_order: 2, active: true },
  { id: 'item-3', section: 'Safety', item_text: 'Emergency intercom works', display_order: 3, active: false },
  { id: 'item-1', section: 'Structural', item_text: 'Shaft walls free of cracks', display_order: 1, active: true },
];
const store = {
  inspections: [], checklist_results: [], history: [], signatures: [], ai_jobs: [], cv_detections: [],
};

const mockQuery = jest.fn(async (sql, params = []) => {
  // requireRole: SELECT role, status FROM users WHERE id = $1
  if (/FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // liftModel.findById: SELECT ... FROM lifts l ... WHERE l.id = $1
  if (/FROM lifts/i.test(sql)) {
    if (/WHERE l\.id/i.test(sql)) {
      const l = lifts[params[0]];
      return { rows: l ? [l] : [] };
    }
    return { rows: Object.values(lifts) };
  }
  // resident create: INSERT INTO inspections (source_type, resident_id, ...)
  if (/INSERT INTO inspections/i.test(sql) && /resident_id/i.test(sql)) {
    const [
      source_type, resident_id, title, description, location_block,
      location_unit, photo_url, category, ai_priority_score, source_flag,
      cv_detection_id, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
    ] = params;
    const now = new Date().toISOString();
    const row = {
      id: `insp-${store.inspections.length + 1}`,
      source_type,
      resident_id, title, description, location_block,
      location_unit: location_unit ?? null,
      photo_url: photo_url ?? null,
      cv_detection_id: cv_detection_id ?? null,
      gps_lat: gps_lat ?? null,
      gps_lng: gps_lng ?? null,
      gps_accuracy_m: gps_accuracy_m ?? null,
      gps_captured_at: gps_captured_at ?? null,
      photo_pending: false,
      status: 'Open',
      category,
      priority: 'Medium',
      ai_priority_score,
      is_deleted: false,
      source_flag: source_flag ?? 'Resident',
      created_at: now,
      updated_at: now,
    };
    store.inspections.push(row);
    return { rows: [row] };
  }
  // lift inspection create: INSERT INTO inspections (source_type, inspector_id, ...)
  if (/INSERT INTO inspections/i.test(sql) && /inspector_id/i.test(sql)) {
    const [
      inspector_id, lift_id, title, location_block, contractor_id,
      serviced_at, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
    ] = params;
    const now = new Date().toISOString();
    const row = {
      id: `insp-${store.inspections.length + 1}`,
      source_type: 'lift_inspection',
      inspector_id, lift_id, title, location_block, contractor_id,
      serviced_at: serviced_at ?? null,
      gps_lat: gps_lat ?? null,
      gps_lng: gps_lng ?? null,
      gps_accuracy_m: gps_accuracy_m ?? null,
      gps_captured_at: gps_captured_at ?? null,
      status: 'Open',
      category: 'Uncategorised',
      priority: 'Medium',
      is_deleted: false,
      source_flag: 'Inspector',
      created_at: now,
      updated_at: now,
    };
    store.inspections.push(row);
    return { rows: [row] };
  }
  // checklist template: SELECT * FROM checklist_items WHERE active ... ORDER BY
  if (/FROM checklist_items/i.test(sql)) {
    const rows = checklistItems
      .filter((i) => i.active)
      .sort((a, b) => a.display_order - b.display_order);
    return { rows };
  }
  // checklist results: INSERT INTO checklist_results (...) RETURNING *
  if (/INSERT INTO checklist_results/i.test(sql)) {
    const [inspection_id, checklist_item_id, result, severity, remark, photo_url] = params;
    const row = {
      id: `chk-${store.checklist_results.length + 1}`,
      inspection_id,
      checklist_item_id,
      result,
      severity: severity ?? null,
      remark: remark ?? null,
      photo_url: photo_url ?? null,
      rectified: false,
    };
    store.checklist_results.push(row);
    return { rows: [row] };
  }
  // manager queue: SELECT * FROM inspections WHERE is_deleted = FALSE [AND ...]
  if (/SELECT \* FROM inspections\s+WHERE is_deleted/i.test(sql)) {
    let rows = store.inspections.filter((i) => !i.is_deleted);
    // Apply whichever filters appear in the SQL, in param order.
    for (const [, field, idx] of sql.matchAll(/(\w+) = \$(\d+)/g)) {
      rows = rows.filter((i) => i[field] === params[Number(idx) - 1]);
    }
    rows = [...rows].sort((a, b) => (b.ai_priority_score ?? -1) - (a.ai_priority_score ?? -1));
    return { rows };
  }
  // detail history: SELECT ... FROM inspection_history h LEFT JOIN users ...
  if (/FROM inspection_history/i.test(sql)) {
    const rows = store.history
      .filter((h) => h.inspection_id === params[0])
      .map((h) => ({ ...h, actor_name: h.actor_id === 'mgr-1' ? 'Mdm Tan' : null }));
    return { rows };
  }
  // contractor dropdown: SELECT * FROM contractors ORDER BY name
  if (/SELECT \* FROM contractors/i.test(sql)) {
    return { rows: [{ id: 'con-1', name: 'Otis Service SG', brands_serviced: 'Otis' }] };
  }
  // cvDetectionModel.findById, joined into findDetailById for the CV overlay.
  if (/SELECT \* FROM cv_detections WHERE id/i.test(sql)) {
    const row = store.cv_detections.find((d) => d.id === params[0]);
    return { rows: row ? [row] : [] };
  }
  // updateByManager row lock: SELECT * FROM inspections WHERE id = $1 ... FOR UPDATE
  // Return a copy — Postgres returns a snapshot, and the UPDATE branch below
  // mutates the stored object in place.
  if (/SELECT \* FROM inspections WHERE id/i.test(sql)) {
    const row = store.inspections.find((i) => i.id === params[0] && !i.is_deleted);
    return { rows: row ? [{ ...row }] : [] };
  }
  // close (UC-004): UPDATE inspections SET status='Closed', is_deleted=TRUE, ...
  // Intercept before the generic UPDATE branch (status/is_deleted/closed_at are
  // SQL literals/expressions, not $-params, so the generic parser can't set them).
  if (/UPDATE inspections[\s\S]*is_deleted = TRUE/i.test(sql)) {
    const [id, closing_remark, actual_cost] = params;
    const row = store.inspections.find((i) => i.id === id);
    if (!row) return { rows: [] };
    row.status = 'Closed';
    row.is_deleted = true;
    row.closing_remark = closing_remark;
    row.actual_cost = actual_cost ?? null;
    row.closed_at = new Date().toISOString();
    row.resolution_time_hours =
      Math.round(((Date.now() - new Date(row.created_at)) / 3600000) * 100) / 100;
    row.updated_at = new Date().toISOString();
    return { rows: [{ ...row }] };
  }
  // signatures: INSERT INTO signatures (...) RETURNING *
  if (/INSERT INTO signatures/i.test(sql)) {
    const [inspection_id, signer_role, signer_id, image_url] = params;
    const row = {
      id: `sig-${store.signatures.length + 1}`,
      inspection_id, signer_role, signer_id, image_url,
    };
    store.signatures.push(row);
    return { rows: [row] };
  }
  // recurrence count: SELECT COUNT(*)::int AS n FROM inspections WHERE status='Closed'
  if (/COUNT\(\*\)/i.test(sql) && /status = 'Closed'/i.test(sql)) {
    const [block, category] = params;
    const n = store.inspections.filter(
      (i) => i.status === 'Closed' && i.location_block === block && i.category === category
    ).length;
    return { rows: [{ n }] };
  }
  // recurrence queue: INSERT INTO ai_jobs (...)
  if (/INSERT INTO ai_jobs/i.test(sql)) {
    const [location_block, category, triggered_by] = params;
    store.ai_jobs.push({ location_block, category, triggered_by });
    return { rows: [] };
  }
  // updateByManager: UPDATE inspections SET <dynamic fields> WHERE id = $N
  if (/UPDATE inspections SET/i.test(sql)) {
    const row = store.inspections.find((i) => i.id === params[params.length - 1]);
    if (!row) return { rows: [] };
    for (const [, field, idx] of sql.matchAll(/(\w+) = \$(\d+)/g)) {
      if (field !== 'id') row[field] = params[Number(idx) - 1];
    }
    row.updated_at = new Date().toISOString();
    return { rows: [row] };
  }
  // audit trail: INSERT INTO inspection_history (...)
  if (/INSERT INTO inspection_history/i.test(sql)) {
    const [inspection_id, actor_id, action, previous_status, new_status, note] = params;
    store.history.push({ inspection_id, actor_id, action, previous_status, new_status, note });
    return { rows: [] };
  }
  // contractor existence check: SELECT id FROM contractors WHERE id = $1
  if (/SELECT id FROM contractors/i.test(sql)) {
    return { rows: params[0] === 'con-1' ? [{ id: 'con-1' }] : [] };
  }
  // status board: SELECT id, location_block, ... WHERE source_type = 'resident_complaint'
  if (/SELECT id, location_block/i.test(sql)) {
    const rows = store.inspections
      .filter((i) => i.source_type === 'resident_complaint' && !i.is_deleted)
      .map(({ id, location_block, category, status, created_at }) => ({
        id, location_block, category, status, created_at,
      }));
    return { rows };
  }
  // listMine: SELECT * FROM inspections WHERE (resident_id = $1 OR inspector_id = $1) ...
  if (/SELECT \* FROM inspections/i.test(sql) && /inspector_id = \$1/i.test(sql)) {
    const [userId] = params;
    const rows = store.inspections.filter(
      (i) => (i.resident_id === userId || i.inspector_id === userId) && !i.is_deleted
    );
    return { rows };
  }
  // duplicate guard: SELECT id FROM inspections WHERE resident_id=$1 AND title=$2 ...
  if (/SELECT id FROM inspections/i.test(sql)) {
    const [resident_id, title] = params;
    const dup = store.inspections.filter(
      (i) => i.resident_id === resident_id && i.title === title && !i.is_deleted
    );
    return { rows: dup.map((i) => ({ id: i.id })) };
  }
  // BEGIN / COMMIT / ROLLBACK and anything else.
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  // The transactional model path uses pool.connect(); hand it the same query fn.
  pool: {
    connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })),
  },
  testConnection: jest.fn(),
  query: mockQuery,
}));

const request = require('supertest');
const app = require('../../src/app');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

beforeEach(() => {
  store.inspections.length = 0;
  store.checklist_results.length = 0;
  store.history.length = 0;
  store.signatures.length = 0;
  store.ai_jobs.length = 0;
  store.cv_detections.length = 0;
  jest.clearAllMocks();
});

// Seed one resident complaint through the real create path; returns its id.
async function seedComplaint(title = 'Corridor light out') {
  const res = await request(app)
    .post('/api/inspections')
    .set('Authorization', 'Bearer resident-token')
    .field('title', title)
    .field('description', 'Details here')
    .field('location_block', '44A');
  return res.body.id;
}

describe('POST /api/inspections', () => {
  test('401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .field('title', 'Leak')
      .field('description', 'Water everywhere')
      .field('location_block', 'A');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('403 when the user is not a resident', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer manager-token')
      .field('title', 'Leak')
      .field('description', 'Water everywhere')
      .field('location_block', 'A');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('description', 'No title here')
      .field('location_block', 'A');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('201 creates the complaint, categorises it, and stores the photo', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Water leak in stairwell')
      .field('description', 'Dripping from ceiling')
      .field('location_block', 'B')
      .field('gps_lat', '1.3521')
      .field('gps_lng', '103.8198')
      .field('gps_accuracy_m', '12')
      .field('gps_captured_at', '2026-07-11T08:00:00.000Z')
      .attach('photo', PNG, 'test.png');

    expect(res.status).toBe(201);
    expect(res.body.source_type).toBe('resident_complaint');
    // Optional GPS stored verbatim; block stays the authoritative location.
    expect(res.body.gps_lat).toBe('1.3521');
    expect(res.body.gps_accuracy_m).toBe('12');
    expect(res.body.location_block).toBe('B');
    expect(res.body.category).toBe('Uncategorised');
    expect(res.body.ai_priority_score).toBe(50);
    expect(res.body.status).toBe('Open');
    expect(res.body.photo_url).toBeTruthy();

    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(1);
  });

  test('409 on a duplicate title within 2 minutes', async () => {
    const submit = () =>
      request(app)
        .post('/api/inspections')
        .set('Authorization', 'Bearer resident-token')
        .field('title', 'Broken lift on level 3')
        .field('description', 'Lift is stuck')
        .field('location_block', 'C');

    const first = await submit();
    expect(first.status).toBe(201);

    const second = await submit();
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_SUBMISSION');
  });
});

describe('POST /api/inspections/lift', () => {
  // Multipart: lift_id + checklist (JSON string) fields, photos as
  // photo_<checklist_item_id> file parts.
  const validChecklist = [
    { checklist_item_id: 'item-1', result: 'Pass' },
    { checklist_item_id: 'item-2', result: 'Defect', severity: 'Major', remark: 'Door sensor slow' },
  ];

  test('201 inspector creates a lift inspection with checklist results and a defect photo', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('lift_id', 'lift-1')
      .field('serviced_at', '2026-03-22')
      .field('checklist', JSON.stringify(validChecklist))
      .attach('photo_item-2', PNG, 'defect.png');

    expect(res.status).toBe(201);
    expect(res.body.source_type).toBe('lift_inspection');
    // Servicing Date from the paper form header (migration 027).
    expect(res.body.serviced_at).toBe('2026-03-22');
    expect(res.body.inspector_id).toBe('ins-1');
    expect(res.body.lift_id).toBe('lift-1');
    // Derived from the lift row, not the request.
    expect(res.body.contractor_id).toBe('con-1');
    expect(res.body.location_block).toBe('44A');
    expect(res.body.title).toBe('Lift inspection — 44A-L1');
    expect(res.body.checklist_results).toHaveLength(2);
    expect(res.body.checklist_results[1].severity).toBe('Major');
    // Photo landed on the Defect row only.
    expect(res.body.checklist_results[1].photo_url).toBeTruthy();
    expect(res.body.checklist_results[0].photo_url).toBeNull();

    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(1);
  });

  test('201 stores serviced_at as NULL when the field is blank or absent', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('lift_id', 'lift-1')
      .field('serviced_at', '')
      .field('checklist', JSON.stringify(validChecklist));

    expect(res.status).toBe(201);
    expect(res.body.serviced_at).toBeNull();
  });

  test('403 when the user is not an inspector', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer resident-token')
      .field('lift_id', 'lift-1')
      .field('checklist', JSON.stringify(validChecklist));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('400 when lift_id is missing', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('checklist', JSON.stringify(validChecklist));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('400 when checklist is not valid JSON', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('lift_id', 'lift-1')
      .field('checklist', 'not-json');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('404 when the lift does not exist', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('lift_id', 'lift-nope')
      .field('checklist', JSON.stringify(validChecklist));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/inspections/my', () => {
  test('200 returns only the caller\'s own reports, wrapped in { data }', async () => {
    // Seed one report belonging to the resident via the real create path.
    await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Cracked tile at void deck')
      .field('description', 'Sharp edge exposed')
      .field('location_block', 'A');

    const res = await request(app)
      .get('/api/inspections/my')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Cracked tile at void deck');
    expect(res.body.data[0].resident_id).toBe('res-1');
  });

  test('403 for a manager (originators only)', async () => {
    const res = await request(app)
      .get('/api/inspections/my')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/inspections/status-board', () => {
  test('200 returns privacy-safe complaint rows only (no lift inspections)', async () => {
    // Seed one resident complaint and one lift inspection via the real paths.
    await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Void deck light flickering')
      .field('description', 'Near block letterboxes')
      .field('location_block', '44A')
      .field('location_unit', '12-05');
    await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('lift_id', 'lift-1')
      .field('checklist', JSON.stringify([{ checklist_item_id: 'item-1', result: 'Pass' }]));

    const res = await request(app)
      .get('/api/inspections/status-board')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1); // lift inspection excluded
    const row = res.body.data[0];
    expect(row.location_block).toBe('44A');
    expect(row.status).toBe('Open');
    // Privacy guard: no identifying fields may ever appear.
    expect(row).not.toHaveProperty('title');
    expect(row).not.toHaveProperty('description');
    expect(row).not.toHaveProperty('resident_id');
    expect(row).not.toHaveProperty('location_unit');
    expect(row).not.toHaveProperty('photo_url');
  });

  test('200 for other authenticated roles (e.g. manager)', async () => {
    const res = await request(app)
      .get('/api/inspections/status-board')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/inspections/status-board');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('PATCH /api/inspections/:id', () => {
  test('200 manager assigns a contractor — status, deadline, history, socket', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ contractor_id: 'con-1', note: 'Lift specialist to attend' });

    expect(res.status).toBe(200);
    expect(res.body.contractor_id).toBe('con-1');
    expect(res.body.status).toBe('Assigned'); // UC-002 default on assign
    expect(res.body.target_deadline).toBeTruthy(); // 14-day rule auto-set

    // Audit row written with the transition.
    expect(store.history).toHaveLength(1);
    expect(store.history[0]).toMatchObject({
      inspection_id: id,
      actor_id: 'mgr-1',
      action: 'Assigned',
      previous_status: 'Open',
      new_status: 'Assigned',
      note: 'Lift specialist to attend',
    });

    // Live update pushed to managers + the block's residents.
    const socketService = require('../../src/services/socketService');
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room', 'block-44A'],
      'status_update',
      expect.objectContaining({ id, status: 'Assigned' })
    );
  });

  test('200 blank target_deadline falls back to the 14-day rule', async () => {
    const id = await seedComplaint('Flickering lobby light');

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ target_deadline: '' });

    expect(res.status).toBe(200);
    const days = (new Date(res.body.target_deadline) - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(14);
  });

  test('200 priority-only change writes a Priority Escalated history row', async () => {
    const id = await seedComplaint('Loose railing');

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ priority: 'Critical' });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('Critical');
    expect(store.history[0].action).toBe('Priority Escalated');
  });

  test('403 when the caller is not a manager', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer resident-token')
      .send({ priority: 'High' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('404 for an unknown inspection id', async () => {
    const res = await request(app)
      .patch('/api/inspections/insp-nope')
      .set('Authorization', 'Bearer manager-token')
      .send({ priority: 'High' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('400 for an invalid status value', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'Fixed' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('400 when no updatable field is provided', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ note: 'just a note' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/inspections (manager queue)', () => {
  test('200 lists all records with filters applied', async () => {
    await seedComplaint('Leak at 44A');
    const id2 = (await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Broken bench')
      .field('description', 'Slats missing')
      .field('location_block', '45B')).body.id;

    const all = await request(app)
      .get('/api/inspections')
      .set('Authorization', 'Bearer manager-token');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);

    const filtered = await request(app)
      .get('/api/inspections?block=45B')
      .set('Authorization', 'Bearer manager-token');
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.data[0].id).toBe(id2);
  });

  test('403 for non-managers', async () => {
    const res = await request(app)
      .get('/api/inspections')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/inspections/:id (manager detail)', () => {
  test('200 returns the record with its audit history', async () => {
    const id = await seedComplaint('Stuck rubbish chute');
    await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ priority: 'High', note: 'Escalating' });

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Stuck rubbish chute');
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({
      action: 'Priority Escalated',
      actor_name: 'Mdm Tan',
      note: 'Escalating',
    });
  });

  test('200 includes the linked cv_detection (bounding box etc.) when cv_detection_id is set', async () => {
    const id = await seedComplaint('Auto-detected: scratch');
    store.inspections.find((i) => i.id === id).cv_detection_id = 'cv-1';
    store.cv_detections.push({
      id: 'cv-1',
      image_url: 'https://example.com/photo.jpg',
      defect_class: 'scratch',
      confidence: '0.8047',
      bounding_box: { x: 860, y: 329.5, width: 164, height: 67 },
      source: 'resident_upload',
      status: 'processed',
    });

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.cv_detection).toMatchObject({
      id: 'cv-1',
      defect_class: 'scratch',
      bounding_box: { x: 860, y: 329.5, width: 164, height: 67 },
    });
  });

  test('200 cv_detection is null when the record has no cv_detection_id', async () => {
    const id = await seedComplaint('Plain complaint, no CV');

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.cv_detection).toBeNull();
  });

  test('404 for an unknown id', async () => {
    const res = await request(app)
      .get('/api/inspections/insp-nope')
      .set('Authorization', 'Bearer manager-token');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/contractors', () => {
  test('200 for a manager', async () => {
    const res = await request(app)
      .get('/api/contractors')
      .set('Authorization', 'Bearer manager-token');
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Otis Service SG');
  });

  test('403 for a resident', async () => {
    const res = await request(app)
      .get('/api/contractors')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/inspections/:id/close', () => {
  const REMARK = 'Technician replaced the faulty button; verified working on site.';

  // Close a record with the two required signature parts + a valid endorser.
  function closeRecord(id, extra = {}) {
    const req = request(app)
      .post(`/api/inspections/${id}/close`)
      .set('Authorization', 'Bearer manager-token')
      .field('closing_remark', extra.remark ?? REMARK)
      .field('endorser_role', 'inspector')
      .field('endorser_id', 'ins-1');
    if (extra.actual_cost !== undefined) req.field('actual_cost', extra.actual_cost);
    if (!extra.omitManagerSig) req.attach('manager_signature', PNG, 'mgr.png');
    if (!extra.omitEndorserSig) req.attach('endorser_signature', PNG, 'insp.png');
    return req;
  }

  test('200 closes with remark + dual signatures, computes fields, archives', async () => {
    const id = await seedComplaint('Lift button stuck at L3');

    const res = await closeRecord(id, { actual_cost: '250.50' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Closed');
    expect(res.body.is_deleted).toBe(true);
    expect(res.body.closed_at).toBeTruthy();
    expect(res.body.resolution_time_hours).not.toBeNull();

    // Two signatures stored: manager + endorser.
    expect(store.signatures).toHaveLength(2);
    expect(store.signatures.map((s) => s.signer_role).sort()).toEqual(['inspector', 'manager']);
    expect(store.signatures.find((s) => s.signer_role === 'manager').signer_id).toBe('mgr-1');

    // 'Closed' audit row written.
    expect(store.history.some((h) => h.action === 'Closed')).toBe(true);

    // Both signatures uploaded to the /signatures folder.
    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledWith(expect.anything(), 'signatures');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(2);
  });

  test('400 when the closing remark is too short', async () => {
    const id = await seedComplaint('Short remark case');
    const res = await closeRecord(id, { remark: 'too short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Closing remark must be at least 10 characters.');
  });

  test('400 when a signature image is missing', async () => {
    const id = await seedComplaint('Missing signature case');
    const res = await closeRecord(id, { omitEndorserSig: true });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('403 when the caller is not a manager', async () => {
    const id = await seedComplaint('Wrong role case');
    const res = await request(app)
      .post(`/api/inspections/${id}/close`)
      .set('Authorization', 'Bearer resident-token')
      .field('closing_remark', REMARK)
      .field('endorser_role', 'inspector')
      .field('endorser_id', 'ins-1')
      .attach('manager_signature', PNG, 'm.png')
      .attach('endorser_signature', PNG, 'e.png');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('404 for an unknown inspection id', async () => {
    const res = await closeRecord('insp-nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('404 when the endorser is not a real user', async () => {
    const id = await seedComplaint('Bad endorser case');
    const res = await request(app)
      .post(`/api/inspections/${id}/close`)
      .set('Authorization', 'Bearer manager-token')
      .field('closing_remark', REMARK)
      .field('endorser_role', 'inspector')
      .field('endorser_id', 'ghost-user')
      .attach('manager_signature', PNG, 'm.png')
      .attach('endorser_signature', PNG, 'e.png');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('queues an ai_jobs row on the 3rd close of a block+category in 30 days', async () => {
    // Three complaints in the same block+category (default 'Uncategorised').
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      ids.push(await seedComplaint(`Recurring defect ${i}`));
    }
    // eslint-disable-next-line no-await-in-loop
    for (const id of ids) await closeRecord(id);

    // Only the 3rd close crosses the threshold → exactly one queued job.
    expect(store.ai_jobs).toHaveLength(1);
    expect(store.ai_jobs[0]).toMatchObject({ location_block: '44A', category: 'Uncategorised' });
  });
});

describe('GET /api/checklist-items', () => {
  test('200 returns active template items sorted by display_order', async () => {
    const res = await request(app)
      .get('/api/checklist-items')
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(200);
    // Inactive item-3 excluded; remaining two in display_order.
    expect(res.body.map((i) => i.id)).toEqual(['item-1', 'item-2']);
  });
});

describe('GET /api/lifts', () => {
  test('200 returns lifts with contractor names for an inspector', async () => {
    const res = await request(app)
      .get('/api/lifts')
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].lift_code).toBe('44A-L1');
    expect(res.body[0].contractor_name).toBe('Otis Service SG');
  });

  test('403 for a non-inspector', async () => {
    const res = await request(app)
      .get('/api/lifts')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
