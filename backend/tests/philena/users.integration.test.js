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
      if (token === 'manager-token') {
        return { data: { claims: { sub: 'mgr-1', email: 'mgr@example.com' } }, error: null };
      }
      // ins-2 is suspended but still holds a valid Supabase token — Supabase has
      // no idea the app suspended them (G16).
      if (token === 'suspended-token') {
        return { data: { claims: { sub: 'ins-2', email: 'old@example.com' } }, error: null };
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
  'mgr-1': { id: 'mgr-1', email: 'mgr@example.com', full_name: 'Priya Nair', role: 'manager', status: 'active' },
  // Endorser candidates for GET /api/users/inspectors (G7).
  'ins-1': { id: 'ins-1', email: 'ins@example.com', full_name: 'Wei Lim', role: 'inspector', status: 'active' },
  'ins-2': { id: 'ins-2', email: 'old@example.com', full_name: 'Retired Inspector', role: 'inspector', status: 'suspended' },
};

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    // findActiveInspectors: SELECT ... WHERE role = 'inspector' AND status = 'active'
    if (/FROM users/i.test(sql) && /role = 'inspector'/i.test(sql)) {
      return {
        rows: Object.values(users).filter(
          (u) => u.role === 'inspector' && u.status === 'active'
        ),
      };
    }
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

  test('403 ACCOUNT_SUSPENDED for a suspended account', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer suspended-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });
});

// G16: the suspension gate belongs in requireAuth, not only in getMe. Before it
// moved there, a suspended account was refused its own profile but could still
// call every requireAuth-only route — the estate status board among them.
describe('suspended accounts on requireAuth-only routes', () => {
  test('403 ACCOUNT_SUSPENDED on the status board, which has no role guard', async () => {
    const res = await request(app)
      .get('/api/inspections/status-board')
      .set('Authorization', 'Bearer suspended-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  test('an active account still reaches the same route', async () => {
    const res = await request(app)
      .get('/api/inspections/status-board')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
  });
});

// Endorser candidates for the UC-004 close panel (G7).
describe('GET /api/users/inspectors', () => {
  test('200 returns active inspectors only', async () => {
    const res = await request(app)
      .get('/api/users/inspectors')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    // ins-2 is suspended and must not be offered as an endorser.
    expect(res.body.map((u) => u.id)).toEqual(['ins-1']);
    expect(res.body[0].full_name).toBe('Wei Lim');
  });

  test('403 for a non-manager', async () => {
    const res = await request(app)
      .get('/api/users/inspectors')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
