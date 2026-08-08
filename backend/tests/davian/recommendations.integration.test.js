// Integration tests for the UC-006 recommendation routes. The app runs
// in-process (supertest); four boundaries are mocked so the test is
// deterministic and hits no network:
//   - config/env:      known CRON_SECRET + no OPENAI_API_KEY (alert text uses
//                      the deterministic fallback template, no OpenAI call)
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:       SQL-routed mock standing in for Postgres
// Verifies auth, role-based access (CRON_SECRET vs manager), and endpoint behaviour.
'use strict';

// --- Mock: env. Dummy values for boot + a known cron secret. ---
jest.mock('../../src/config/env', () => ({
  PORT: 5000,
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test',
  CLOUDINARY_API_SECRET: 'test',
  CRON_SECRET: 'test-cron-secret',
  OPENAI_API_KEY: undefined, // force the fallback alert template (no network)
}));

// --- Mock: Supabase auth. Token string maps to claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
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

// --- Mock: the pg layer, routed by SQL. ---
const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};

const mockQuery = jest.fn(async (sql, params = []) => {
  // requireRole
  if (/SELECT role, status FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // runAnalysis: pending jobs (none — exercise the general scan path)
  if (/FROM ai_jobs/i.test(sql) && /pending/i.test(sql)) {
    return { rows: [] };
  }
  if (/UPDATE ai_jobs/i.test(sql)) return { rows: [] };
  // general scan: one qualifying pair
  if (/GROUP BY location_block, category/i.test(sql)) {
    return { rows: [{ location_block: '44A', category: 'Lift' }] };
  }
  // velocityCalculator aggregate: 5 current vs 2 prior -> 150%, eligible
  if (/COUNT\(\*\) FILTER/i.test(sql)) {
    return { rows: [{ count_last_30: '5', count_prior_30: '2' }] };
  }
  // estimated cost
  if (/AVG\(actual_cost\)/i.test(sql)) {
    return { rows: [{ avg_cost: 1000 }] };
  }
  // persist an alert
  if (/INSERT INTO ai_predictions/i.test(sql)) {
    const [location_block, category, velocity_pct, estimated_cost, alert_text] = params;
    return {
      rows: [{ id: 'pred-int-1', location_block, category, velocity_pct, estimated_cost, alert_text, status: 'Active' }],
    };
  }
  // accept/dismiss status change ($1 id, $2 status)
  if (/UPDATE ai_predictions/i.test(sql)) {
    if (params[0] === 'missing') return { rows: [] };
    return {
      rows: [{
        id: params[0], location_block: '44A', category: 'Lift',
        velocity_pct: 150, estimated_cost: 1000, status: params[1],
      }],
    };
  }
  // acceptAlert inspection creation
  if (/INSERT INTO inspections/i.test(sql)) {
    return { rows: [{ id: 'insp-int-1' }] };
  }
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  pool: { connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })) },
  testConnection: jest.fn(),
  query: mockQuery,
}));

// --- Mock: Socket.IO emit seam (no server in tests). acceptAlert emits
// status_update to 'manager-room' after creating the follow-up inspection.
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

const request = require('supertest');
const app = require('../../src/app');

beforeEach(() => jest.clearAllMocks());

describe('GET /api/recommendations/run — access control', () => {
  test('401 with neither a cron secret nor a session', async () => {
    const res = await request(app).get('/api/recommendations/run');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('403 for a non-manager session', async () => {
    const res = await request(app)
      .get('/api/recommendations/run')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/recommendations/run — behaviour', () => {
  test('200 via CRON_SECRET generates an alert for the eligible pair', async () => {
    const res = await request(app)
      .get('/api/recommendations/run')
      .set('Authorization', 'Bearer test-cron-secret');

    expect(res.status).toBe(200);
    expect(res.body.alerts_generated).toBe(1);
    expect(res.body.generated[0]).toMatchObject({ location_block: '44A', category: 'Lift', velocity_pct: 150 });
    // cron path must not touch Supabase auth
    const supabase = require('../../src/config/supabase');
    expect(supabase.auth.getClaims).not.toHaveBeenCalled();
  });

  test('200 for a manager session also generates the alert', async () => {
    const res = await request(app)
      .get('/api/recommendations/run')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.alerts_generated).toBe(1);
    // estimated_cost projected from avg actual_cost (1000 × 1)
    expect(res.body.generated[0].estimated_cost).toBe(1000);
  });
});

describe('POST /api/recommendations/:id/accept', () => {
  test('401 without a token', async () => {
    const res = await request(app).post('/api/recommendations/pred-1/accept');
    expect(res.status).toBe(401);
  });

  test('403 for a resident', async () => {
    const res = await request(app)
      .post('/api/recommendations/pred-1/accept')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });

  test('200 for a manager: status Accepted and a new inspection is created', async () => {
    const res = await request(app)
      .post('/api/recommendations/pred-1/accept')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prediction_id: 'pred-1', status: 'Accepted', inspection_id: 'insp-int-1' });
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO inspections/i.test(sql));
    expect(insertCall[0]).toMatch(/'AI-Generated'/);
  });
});

describe('POST /api/recommendations/:id/dismiss', () => {
  test('200 for a manager: status Dismissed', async () => {
    const res = await request(app)
      .post('/api/recommendations/pred-1/dismiss')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prediction_id: 'pred-1', status: 'Dismissed' });
  });

  test('404 when the prediction id is unknown', async () => {
    const res = await request(app)
      .post('/api/recommendations/missing/dismiss')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('403 for a resident', async () => {
    const res = await request(app)
      .post('/api/recommendations/pred-1/dismiss')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });
});
