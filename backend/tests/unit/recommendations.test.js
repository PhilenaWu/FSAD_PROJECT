// Unit tests for the recommendations list endpoint (UC-005 dashboard reads
// active AI alerts from ai_predictions). runAnalysis/accept/dismiss are
// UC-006 and get their tests when they land. Same mocked-supertest style as
// the analytics tests.
'use strict';

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

const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};

const alerts = [
  {
    id: 'pred-1',
    location_block: '44A',
    category: 'Lift',
    velocity_pct: 60,
    alert_text: 'Block 44A lift failures up 60% in 30 days.',
    status: 'Active',
    created_at: '2026-07-10T02:00:00Z',
  },
];

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    if (/SELECT role, status FROM users/i.test(sql)) {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    }
    if (/FROM ai_predictions/i.test(sql)) {
      // status param present unless ?status=all
      const status = params[0];
      return { rows: status ? alerts.filter((a) => a.status === status) : alerts };
    }
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/recommendations', () => {
  test('200 with active alerts by default for a manager', async () => {
    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      location_block: '44A',
      category: 'Lift',
      velocity_pct: 60,
      status: 'Active',
    });
  });

  test('?status=Dismissed filters accordingly', async () => {
    const res = await request(app)
      .get('/api/recommendations')
      .query({ status: 'Dismissed' })
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/recommendations');
    expect(res.status).toBe(401);
  });

  test('403 for a non-manager role', async () => {
    const res = await request(app)
      .get('/api/recommendations')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
  });
});
