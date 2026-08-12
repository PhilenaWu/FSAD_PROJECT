// Integration tests: token verification against protected routes.
//
// Auth itself is handled by Supabase on the client (see AGENTS.md), so there are
// no custom auth endpoints to test. What IS ours — and what this file pins — is
// the boundary every protected route sits behind: `requireAuth` verifies the
// Supabase token, then `requireRole` checks the app role read from the `users`
// profile row. This suite is the automated form of the manual security probe
// done before final review (every dashboard endpoint called with no token, and
// each one expected to refuse), so a future refactor cannot quietly re-open a
// route that used to be closed.
//
// The app runs in-process (supertest) with the two boundaries mocked, so no
// network and no Postgres are involved:
//   - config/supabase: fake getClaims maps a token string to claims
//   - config/db:       answers the profile lookup; everything else is empty
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      const claimsFor = {
        'manager-token': { sub: 'mgr-1', email: 'mgr@example.com' },
        'admin-token': { sub: 'adm-1', email: 'adm@example.com' },
        'resident-token': { sub: 'res-1', email: 'res@example.com' },
        // Valid signature, but no `users` row was ever created for this id.
        'ghost-token': { sub: 'ghost-1', email: 'ghost@example.com' },
        // A resident's token that also carries `role: 'manager'` in its claims.
        // Supabase's own `role` claim is the Postgres role (normally
        // 'authenticated'), NOT the app role — so this must buy nothing.
        'claims-role-token': { sub: 'res-1', email: 'res@example.com', role: 'manager' },
        // These three hold perfectly valid tokens — Supabase has no idea the app
        // blocked them. All three are given the manager role on purpose, so the
        // only possible reason for a refusal below is the account status.
        'suspended-token': { sub: 'sus-1', email: 'sus@example.com' },
        'pending-token': { sub: 'pen-1', email: 'pen@example.com' },
        'rejected-token': { sub: 'rej-1', email: 'rej@example.com' },
      }[token];

      if (!claimsFor) return { data: null, error: { message: 'invalid token' } };
      return { data: { claims: claimsFor }, error: null };
    }),
  },
}));

// --- Mock: the pg layer. Only the profile lookup needs real answers. ---
const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'adm-1': { role: 'admin', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
  'sus-1': { role: 'manager', status: 'suspended' },
  'pen-1': { role: 'manager', status: 'pending' },
  'rej-1': { role: 'manager', status: 'rejected' },
};

const mockQuery = jest.fn(async (sql, params = []) => {
  if (/SELECT role, status FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // Everything else: the two filter-options endpoints used for the happy paths
  // below only run DISTINCT queries, so empty rows are a valid 200.
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: (...args) => mockQuery(...args),
}));

const request = require('supertest');
const app = require('../../src/app');

// Every route in the UC-005 / UC-011 surface. Listed explicitly rather than
// derived from the router: a hand-written list is what catches a new endpoint
// being added without a guard, since a derived list would inherit the mistake.
const PROTECTED_ROUTES = [
  ['get', '/api/analytics/filter-options'],
  ['get', '/api/analytics/summary'],
  ['get', '/api/analytics/issues-by-block'],
  ['get', '/api/analytics/trends'],
  ['get', '/api/analytics/sla-compliance'],
  ['get', '/api/analytics/contractor-scorecard'],
  ['get', '/api/analytics/priority-queue'],
  ['get', '/api/admin/costs/summary'],
  ['get', '/api/admin/costs/filter-options'],
  ['get', '/api/admin/costs/jobs'],
  ['get', '/api/admin/costs/breakdown'],
  ['get', '/api/admin/costs/trends'],
  ['post', '/api/export/pptx'],
  ['post', '/api/export/admin-costs-pptx'],
];

// This suite is almost entirely error paths, and the shared error handler logs
// every one. Silencing keeps the run readable (same approach as
// tests/zoe/notifications.test.js and tests/philena/overdueChase.test.js).
let consoleError;
beforeAll(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  consoleError.mockRestore();
});

beforeEach(() => {
  mockQuery.mockClear();
});

describe('no token reaches no protected route', () => {
  test.each(PROTECTED_ROUTES)('%s %s → 401 UNAUTHENTICATED', async (method, path) => {
    const res = await request(app)[method](path);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('the profile lookup never runs when there is no token', async () => {
    await request(app).get('/api/analytics/summary');

    // Refused before any SQL: an unauthenticated request must not cost a query.
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// The token has to arrive as `Authorization: Bearer <token>` and nowhere else.
describe('how the token must be presented', () => {
  test('401 when the token is sent without the Bearer prefix', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'manager-token');

    expect(res.status).toBe(401);
  });

  test('401 for a different auth scheme carrying the same token', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'Basic manager-token');

    expect(res.status).toBe(401);
  });

  test('401 for the Bearer prefix with an empty token', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
  });

  // Stricter than RFC 7235, which makes the scheme case-insensitive. Pinned
  // because it is harmless here — the only client is services/api.js, which
  // always sends the canonical 'Bearer ' — and because loosening it should be a
  // deliberate change rather than an accident.
  test('401 for a lowercase bearer prefix', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'bearer manager-token');

    expect(res.status).toBe(401);
  });

  test('401 when a valid token is passed as a query parameter instead', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .query({ access_token: 'manager-token' });

    expect(res.status).toBe(401);
  });

  test('401 when the signature does not verify', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'Bearer forged-token');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

// A verified token answers "who is this", never "what may they do". The app
// role comes from the users profile row, which the request cannot influence.
describe('the token identifies, the profile row authorises', () => {
  test('a manager reaches the analytics dashboard', async () => {
    const res = await request(app)
      .get('/api/analytics/filter-options')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
  });

  test('an admin reaches the cost dashboard', async () => {
    const res = await request(app)
      .get('/api/admin/costs/filter-options')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
  });

  test('403 FORBIDDEN: a resident holding a valid token cannot read analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  // The two dashboards are not one permission. Cost figures are admin-only, and
  // the manager analytics are not handed to an admin either.
  test('403 FORBIDDEN: a manager cannot read the admin cost figures', async () => {
    const res = await request(app)
      .get('/api/admin/costs/summary')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('403 FORBIDDEN: an admin cannot read the manager analytics', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('403 FORBIDDEN: the manager cost deck is refused to a manager', async () => {
    const res = await request(app)
      .post('/api/export/admin-costs-pptx')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  // Supabase's `role` claim is the Postgres role, not ours. If it were ever
  // trusted, anyone able to influence their own claims could self-promote.
  test('403 FORBIDDEN: a role claim inside the token grants nothing', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'Bearer claims-role-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  // The client is a convenience, not a boundary: the id the profile is looked up
  // by is the token's `sub`, so naming someone else in the request changes
  // nothing.
  test('403 FORBIDDEN: naming another user in the request does not switch identity', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .query({ userId: 'mgr-1', role: 'manager' })
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    const lookup = mockQuery.mock.calls.find(([sql]) => /FROM users/i.test(sql));
    expect(lookup[1]).toEqual(['res-1']);
  });

  test('403 FORBIDDEN when the verified token has no profile row at all', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', 'Bearer ghost-token');

    // Not a 401 (the token is genuine) and not a 500 (a missing row is an
    // expected state) — the role check simply has no role to admit.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

// G16 and the self-registration statuses. Each of these accounts is a manager,
// so the role would otherwise let them straight in — the status is the only
// thing standing in the way, and each gets its own code so the frontend can
// explain the specific reason rather than showing a generic error.
describe('account status is checked behind a valid token', () => {
  test.each([
    ['suspended-token', 'ACCOUNT_SUSPENDED'],
    ['pending-token', 'ACCOUNT_PENDING'],
    ['rejected-token', 'ACCOUNT_REJECTED'],
  ])('%s → 403 %s even with the manager role', async (token, code) => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(code);
  });

  test('a blocked account is refused on every protected route, not just one', async () => {
    for (const [method, path] of PROTECTED_ROUTES) {
      const res = await request(app)[method](path)
        .set('Authorization', 'Bearer pending-token');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_PENDING');
    }
  });
});
