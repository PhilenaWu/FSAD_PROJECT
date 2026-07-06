// Integration tests for users — GET /api/users/me (returns caller's profile).
// The app runs in-process (supertest). Two boundaries are mocked so the test is
// deterministic and hits no network:
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:        in-memory users store so we exercise the real
//                       controller/model flow without a Postgres connection
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      if (token === 'ghost-token') {
        return { data: { claims: { sub: 'no-profile', email: 'ghost@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: the pg layer. A tiny in-memory users table. ---
const users = {
  'res-1': {
    id: 'res-1',
    email: 'res@example.com',
    full_name: 'Marcus Tan',
    role: 'resident',
    block_number: '44A',
    unit_number: '12-05',
    status: 'active',
  },
};

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    // findById: SELECT * FROM users WHERE id = $1
    if (/FROM users/i.test(sql)) {
      const u = users[params[0]];
      return { rows: u ? [u] : [] };
    }
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/users/me', () => {
  test('401 when no token is provided', async () => {
    const res = await request(app).get('/api/users/me');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('200 returns the caller\'s own profile row', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('res-1');
    expect(res.body.full_name).toBe('Marcus Tan');
    expect(res.body.role).toBe('resident');
    expect(res.body.email).toBe('res@example.com');
    expect(res.body.block_number).toBe('44A');
    expect(res.body.unit_number).toBe('12-05');
  });

  test('404 when the authenticated user has no profile row', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer ghost-token');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
