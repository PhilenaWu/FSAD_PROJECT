// Integration tests for inspections — POST /api/inspections (UC-001 resident
// complaint) and POST /api/inspections/lift (UC-001 inspector lift spot-check).
// The app runs in-process (supertest). Three boundaries are mocked so the test is
// deterministic and hits no network:
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:        in-memory store so we exercise the real controller/model
//                       flow without a Postgres/Supabase connection
//   - cloudinaryService: fake uploadImage (no upload)
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
const store = { inspections: [], checklist_results: [] };

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
      gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
    ] = params;
    const now = new Date().toISOString();
    const row = {
      id: `insp-${store.inspections.length + 1}`,
      source_type,
      resident_id, title, description, location_block,
      location_unit: location_unit ?? null,
      photo_url: photo_url ?? null,
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
      gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
    ] = params;
    const now = new Date().toISOString();
    const row = {
      id: `insp-${store.inspections.length + 1}`,
      source_type: 'lift_inspection',
      inspector_id, lift_id, title, location_block, contractor_id,
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
  jest.clearAllMocks();
});

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
      .field('checklist', JSON.stringify(validChecklist))
      .attach('photo_item-2', PNG, 'defect.png');

    expect(res.status).toBe(201);
    expect(res.body.source_type).toBe('lift_inspection');
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
