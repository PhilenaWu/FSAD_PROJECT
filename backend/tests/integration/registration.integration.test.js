// Integration tests for resident self-registration with manager approval.
// Covers the full lifecycle — register → locked out while pending → manager
// approves → access granted — plus the privilege-escalation and rate-limit
// guards. Same two mocked boundaries as users.integration.test.js:
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:        in-memory users store, so the real controller/model
//                       SQL runs without a Postgres connection
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      // Just signed up in the browser; holds a session but has no profile row.
      if (token === 'new-user-token') {
        return { data: { claims: { sub: 'new-1', email: 'new@example.com' } }, error: null };
      }
      if (token === 'pending-token') {
        return { data: { claims: { sub: 'pen-1', email: 'pen@example.com' } }, error: null };
      }
      if (token === 'manager-token') {
        return { data: { claims: { sub: 'mgr-1', email: 'mgr@example.com' } }, error: null };
      }
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: the pg layer. A tiny in-memory users table, reset per test. ---
let mockUsers = {};

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    // createPendingResident. role/status are SQL literals rather than
    // parameters, so we read them back out of the statement itself — that is
    // precisely the property the escalation test below is asserting.
    if (/^\s*INSERT INTO users/i.test(sql)) {
      const literals = sql.match(/VALUES\s*\(\$1,\s*\$2,\s*\$3,\s*'(\w+)',\s*'(\w+)'/i);
      const [id, email, full_name, block_number, unit_number] = params;
      const row = {
        id,
        email,
        full_name,
        role: literals[1],
        status: literals[2],
        block_number,
        unit_number,
        created_at: '2026-08-07T09:00:00.000Z',
      };
      mockUsers[id] = row;
      return { rows: [row] };
    }
    // setStatus: UPDATE users SET status = $2 ... WHERE id = $1
    if (/^\s*UPDATE users/i.test(sql)) {
      const row = mockUsers[params[0]];
      if (!row) return { rows: [] };
      row.status = params[1];
      return { rows: [row] };
    }
    // findPendingResidents
    if (/FROM users/i.test(sql) && /role = 'resident' AND status = 'pending'/i.test(sql)) {
      return {
        rows: Object.values(mockUsers).filter(
          (u) => u.role === 'resident' && u.status === 'pending'
        ),
      };
    }
    // findById / requireAuth's role+status lookup
    if (/FROM users/i.test(sql)) {
      const u = mockUsers[params[0]];
      return { rows: u ? [u] : [] };
    }
    return { rows: [] };
  }),
}));

// --- Mock: outbound mail. Nothing leaves the process. ---
jest.mock('../../src/services/emailService', () => ({
  sendResidentApprovedEmail: jest.fn(),
}));

const request = require('supertest');

let app;
let emailService;

beforeEach(() => {
  mockUsers = {
    'pen-1': {
      id: 'pen-1',
      email: 'pen@example.com',
      full_name: 'Nadia Rahman',
      role: 'resident',
      status: 'pending',
      block_number: '44B',
      unit_number: '#08-12',
      created_at: '2026-08-05T02:00:00.000Z',
    },
    'res-1': {
      id: 'res-1',
      email: 'res@example.com',
      full_name: 'Marcus Tan',
      role: 'resident',
      status: 'active',
      block_number: '44A',
      unit_number: '#12-05',
      created_at: '2026-01-04T02:00:00.000Z',
    },
    'mgr-1': {
      id: 'mgr-1',
      email: 'mgr@example.com',
      full_name: 'Priya Nair',
      role: 'manager',
      status: 'active',
      created_at: '2026-01-02T02:00:00.000Z',
    },
  };
  // Fresh module registry per test so each one starts with an empty
  // rate-limit window; otherwise the 5-per-hour register limiter would start
  // rejecting partway through the suite.
  jest.resetModules();
  app = require('../../src/app');
  // Re-required after resetModules so the handle matches the instance the app
  // just loaded; default to a clean successful send.
  emailService = require('../../src/services/emailService');
  emailService.sendResidentApprovedEmail.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/users/register-profile', () => {
  test('401 without a token — the caller must hold the session they signed up with', async () => {
    const res = await request(app)
      .post('/api/users/register-profile')
      .send({ full_name: 'Anon', block_number: '44A' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('201 creates a pending resident', async () => {
    const res = await request(app)
      .post('/api/users/register-profile')
      .set('Authorization', 'Bearer new-user-token')
      .send({ full_name: 'Chen Wei', block_number: '45A', unit_number: '#03-21' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('resident');
    expect(res.body.status).toBe('pending');
    expect(res.body.full_name).toBe('Chen Wei');
    expect(res.body.block_number).toBe('45A');
    // Identity comes from the verified token, never the body.
    expect(res.body.id).toBe('new-1');
    expect(res.body.email).toBe('new@example.com');
  });

  // The core guarantee: registration is the only insert path an unapproved
  // caller can reach, so no body field may raise the role or skip approval.
  test('ignores role, status, id and email supplied in the body', async () => {
    const res = await request(app)
      .post('/api/users/register-profile')
      .set('Authorization', 'Bearer new-user-token')
      .send({
        full_name: 'Escalation Attempt',
        block_number: '44A',
        role: 'admin',
        status: 'active',
        id: 'mgr-1',
        email: 'attacker@example.com',
        contractor_id: 'c-1',
      });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('resident');
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toBe('new-1');
    expect(res.body.email).toBe('new@example.com');
    // The manager whose id was passed is untouched.
    expect(mockUsers['mgr-1'].role).toBe('manager');
  });

  test('400 for a block that is not on the estate list', async () => {
    const res = await request(app)
      .post('/api/users/register-profile')
      .set('Authorization', 'Bearer new-user-token')
      .send({ full_name: 'Chen Wei', block_number: '99Z' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockUsers['new-1']).toBeUndefined();
  });

  test('400 when full_name is missing, even though the client checks it too', async () => {
    const res = await request(app)
      .post('/api/users/register-profile')
      .set('Authorization', 'Bearer new-user-token')
      .send({ block_number: '44A' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('409 when the account already has a profile', async () => {
    const res = await request(app)
      .post('/api/users/register-profile')
      .set('Authorization', 'Bearer resident-token')
      .send({ full_name: 'Marcus Tan', block_number: '44A' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROFILE_EXISTS');
  });

  test('429 once the per-IP registration limit is used up', async () => {
    const attempt = () =>
      request(app)
        .post('/api/users/register-profile')
        .set('Authorization', 'Bearer new-user-token')
        .send({ full_name: 'Chen Wei', block_number: '99Z' }); // rejected, still counted

    for (let i = 0; i < 5; i += 1) {
      expect((await attempt()).status).toBe(400);
    }
    const res = await attempt();

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});

// A pending account holds a perfectly valid Supabase token, so every gate has
// to come from the profile status. It must get nothing — not partial access.
describe('a pending account is locked out everywhere', () => {
  test('403 ACCOUNT_PENDING on its own profile', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer pending-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_PENDING');
  });

  test('403 ACCOUNT_PENDING on a requireAuth-only route with no role guard', async () => {
    const res = await request(app)
      .get('/api/inspections/status-board')
      .set('Authorization', 'Bearer pending-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_PENDING');
  });

  test('403 on a role-guarded route', async () => {
    const res = await request(app)
      .get('/api/users/inspectors')
      .set('Authorization', 'Bearer pending-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_PENDING');
  });

  test('cannot file a report', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer pending-token')
      .field('title', 'Lift stuck')
      .field('location_block', '44B');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_PENDING');
  });
});

describe('manager approval queue', () => {
  test('lists pending residents only', async () => {
    const res = await request(app)
      .get('/api/users/pending-residents')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.id)).toEqual(['pen-1']);
    expect(res.body[0].block_number).toBe('44B');
    expect(res.body[0].unit_number).toBe('#08-12');
  });

  test('403 for a resident', async () => {
    const res = await request(app)
      .get('/api/users/pending-residents')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('approve activates the account, and the resident can then sign in', async () => {
    const approve = await request(app)
      .post('/api/users/pending-residents/pen-1/approve')
      .set('Authorization', 'Bearer manager-token');

    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('active');

    // The same token that was refused a moment ago now resolves the profile,
    // which is what the frontend routes the resident's workspace from.
    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer pending-token');

    expect(me.status).toBe(200);
    expect(me.body.role).toBe('resident');
    expect(me.body.status).toBe('active');
  });

  test('approve emails the resident that they can now sign in', async () => {
    const res = await request(app)
      .post('/api/users/pending-residents/pen-1/approve')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.email_sent).toBe(true);
    expect(emailService.sendResidentApprovedEmail).toHaveBeenCalledTimes(1);
    // Sent the updated row, so the mail can't describe them as still pending.
    const [resident] = emailService.sendResidentApprovedEmail.mock.calls[0];
    expect(resident.email).toBe('pen@example.com');
    expect(resident.full_name).toBe('Nadia Rahman');
    expect(resident.status).toBe('active');
  });

  // G13: mail is best-effort. Un-approving someone because SMTP blipped would
  // be worse than the manager having to tell them by other means.
  test('a failed send still approves the account, and says so', async () => {
    emailService.sendResidentApprovedEmail.mockRejectedValueOnce(new Error('smtp down'));

    const res = await request(app)
      .post('/api/users/pending-residents/pen-1/approve')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.email_sent).toBe(false);
    expect(mockUsers['pen-1'].status).toBe('active');
  });

  test('reject sends no email', async () => {
    await request(app)
      .post('/api/users/pending-residents/pen-1/reject')
      .set('Authorization', 'Bearer manager-token');

    expect(emailService.sendResidentApprovedEmail).not.toHaveBeenCalled();
  });

  test('reject marks the account rejected and keeps it locked out', async () => {
    const reject = await request(app)
      .post('/api/users/pending-residents/pen-1/reject')
      .set('Authorization', 'Bearer manager-token');

    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('rejected');

    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer pending-token');

    expect(me.status).toBe(403);
    expect(me.body.code).toBe('ACCOUNT_REJECTED');
  });

  test('404 when the id is not a pending resident, so no other account can be flipped', async () => {
    const res = await request(app)
      .post('/api/users/pending-residents/mgr-1/approve')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(mockUsers['mgr-1'].role).toBe('manager');
    expect(mockUsers['mgr-1'].status).toBe('active');
  });

  test('403 when a pending resident tries to approve themselves', async () => {
    const res = await request(app)
      .post('/api/users/pending-residents/pen-1/approve')
      .set('Authorization', 'Bearer pending-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_PENDING');
    expect(mockUsers['pen-1'].status).toBe('pending');
  });
});
