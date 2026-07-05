// Integration tests for incidents — POST /api/incidents (UC-001 create).
// The app runs in-process (supertest). Three boundaries are mocked so the test
// is deterministic and hits no network:
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
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: Cloudinary upload. Returns a fixed URL, no network. ---
jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(async () => 'https://cloudinary.test/defects/mock.png'),
}));

// --- Mock: the pg layer. A tiny in-memory model of the two tables we touch. ---
const profiles = {
  'res-1': { role: 'resident', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
};
const store = { incidents: [] };

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    // requireRole: SELECT role, status FROM users WHERE id = $1
    if (/FROM users/i.test(sql)) {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    }
    // create: INSERT INTO incidents (...) RETURNING *
    if (/INSERT INTO incidents/i.test(sql)) {
      const [
        resident_id, title, description, location_block, location_unit,
        photo_url, category, ai_priority_score, source_flag,
      ] = params;
      const now = new Date().toISOString();
      const row = {
        id: `inc-${store.incidents.length + 1}`,
        resident_id, title, description, location_block,
        location_unit: location_unit ?? null,
        photo_url: photo_url ?? null,
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
      store.incidents.push(row);
      return { rows: [row] };
    }
    // duplicate guard: SELECT id FROM incidents WHERE resident_id=$1 AND title=$2 ...
    if (/SELECT id FROM incidents/i.test(sql)) {
      const [resident_id, title] = params;
      const dup = store.incidents.filter(
        (i) => i.resident_id === resident_id && i.title === title && !i.is_deleted
      );
      return { rows: dup.map((i) => ({ id: i.id })) };
    }
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

beforeEach(() => {
  store.incidents.length = 0;
  jest.clearAllMocks();
});

describe('POST /api/incidents', () => {
  test('401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .field('title', 'Leak')
      .field('description', 'Water everywhere')
      .field('location_block', 'A');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('403 when the user is not a resident', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', 'Bearer manager-token')
      .field('title', 'Leak')
      .field('description', 'Water everywhere')
      .field('location_block', 'A');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', 'Bearer resident-token')
      .field('description', 'No title here')
      .field('location_block', 'A');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('201 creates the incident, categorises it, and stores the photo', async () => {
    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Water leak in stairwell')
      .field('description', 'Dripping from ceiling')
      .field('location_block', 'B')
      .attach('photo', PNG, 'test.png');

    expect(res.status).toBe(201);
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
        .post('/api/incidents')
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
