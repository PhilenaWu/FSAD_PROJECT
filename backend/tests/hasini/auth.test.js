// Auth is handled by Supabase on the client (see AGENTS.md) — there are no
// custom auth endpoints to unit-test. Route-level middleware behaviour is
// covered in the integration suites; what's here is requireRole on its own.
'use strict';

jest.mock('../../src/config/supabase', () => ({ auth: { getClaims: jest.fn() } }));
jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(),
}));

const db = require('../../src/config/db');
const { requireRole } = require('../../src/middleware/auth');

// Run the guard against a req whose profile was never loaded by requireAuth, so
// the fallback lookup inside requireRole is the code under test. Resolves with
// the error passed to next(), or null when the request was allowed through.
async function runGuard(profile, roles = ['contractor']) {
  db.query.mockResolvedValueOnce({ rows: profile ? [profile] : [] });
  const req = { user: { id: 'u-1' } };
  return new Promise((resolve) => {
    requireRole(...roles)(req, {}, (err) => resolve(err || null));
  });
}

describe('requireRole', () => {
  // G16: a suspended account must be told it is suspended, not handed the
  // generic wrong-role error — the frontend signs the user out on this code.
  test('403 ACCOUNT_SUSPENDED for a suspended account, not FORBIDDEN', async () => {
    const err = await runGuard({ role: 'contractor', status: 'suspended' });

    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('ACCOUNT_SUSPENDED');
  });

  test('403 FORBIDDEN for an active account with the wrong role', async () => {
    const err = await runGuard({ role: 'resident', status: 'active' });

    expect(err.code).toBe('FORBIDDEN');
  });

  test('passes an active account holding an allowed role', async () => {
    expect(await runGuard({ role: 'contractor', status: 'active' })).toBeNull();
  });

  test('403 FORBIDDEN when the caller has no profile row at all', async () => {
    const err = await runGuard(null);

    expect(err.code).toBe('FORBIDDEN');
  });

  test('401 when there is no authenticated user', async () => {
    const err = await new Promise((resolve) => {
      requireRole('contractor')({ headers: {} }, {}, (e) => resolve(e));
    });

    expect(err.statusCode).toBe(401);
  });
});
