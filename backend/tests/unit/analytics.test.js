// Unit tests for analytics (UC-005) — ANA-T01/T02/T03 from the phase plan plus
// role gating. Same approach as the users tests: the app runs in-process via
// supertest with config/supabase and config/db mocked, so the real route →
// middleware → controller chain runs with no network.
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
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

// --- Mock: the pg layer. Dispatch on SQL shape per endpoint. ---
const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};

const heatmapRows = [
  { block: '44A', category: 'Electrical', count: 2 },
  { block: '44A', category: 'Lift', count: 5 },
  { block: '88B', category: 'Plumbing', count: 7 },
];

const mockQuery = jest.fn(async (sql, params = []) => {
  // requireRole profile lookup
  if (/SELECT role, status FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // Filter options — distinct blocks / categories.
  if (/SELECT DISTINCT location_block AS v/i.test(sql)) {
    return { rows: [{ v: '44A' }, { v: '88B' }] };
  }
  if (/SELECT DISTINCT category AS v/i.test(sql)) {
    return { rows: [{ v: 'Lift' }, { v: 'Plumbing' }] };
  }
  // KPI summary — first query (counts + windows), then its SLA sub-query.
  if (/open_count/i.test(sql)) {
    return {
      rows: [{ open_count: 46, overdue_count: 4, avg_resolution_hours: 58.3, new_last_30: 58, new_prior_30: 41 }],
    };
  }
  if (/AS compliant,/i.test(sql)) {
    return { rows: [{ compliant: 42, total: 55 }] };
  }
  // SLA compliance (aggregate FILTER query)
  if (/compliant_count/i.test(sql)) {
    return { rows: [{ compliant_count: 42, total_resolved: 55 }] };
  }
  // Heatmap (group by block + category) — respect a block filter param so
  // ANA-T02 exercises the WHERE clause path.
  if (/GROUP BY location_block, category/i.test(sql)) {
    const block = params[0]; // only set when filtered
    return { rows: block ? heatmapRows.filter((r) => r.block === block) : heatmapRows };
  }
  // Trends (group by day)
  if (/GROUP BY created_at::date/i.test(sql)) {
    return { rows: [{ date: '2026-06-24', count: 3 }, { date: '2026-06-25', count: 6 }] };
  }
  // Contractor scorecard
  if (/JOIN contractors/i.test(sql)) {
    return {
      rows: [
        { contractor: 'KONE Pte Ltd', jobs: 11, avg_rectification_days: 3.1, repeat_defect_rate: 4.2, overdue_count: 0 },
      ],
    };
  }
  // Priority queue
  if (/composite_score/i.test(sql)) {
    return {
      rows: [
        { id: 'INS-1', title: 'Lift door misalignment', block: '44A', category: 'Lift', priority: 'Critical', status: 'Assigned', ai_priority_score: 88, composite_score: 71.4, created_at: '2026-06-22T09:15:00Z' },
      ],
    };
  }
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: (...args) => mockQuery(...args),
}));

const request = require('supertest');
const app = require('../../src/app');

const asManager = (req) => req.set('Authorization', 'Bearer manager-token');

describe('GET /api/analytics/issues-by-block', () => {
  test('ANA-T01: 200 with array of { block, category, count } for a manager', async () => {
    const res = await asManager(request(app).get('/api/analytics/issues-by-block'));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toEqual({ block: '44A', category: 'Electrical', count: 2 });
  });

  test('ANA-T02: ?block=44A returns only rows for that block', async () => {
    const res = await asManager(
      request(app).get('/api/analytics/issues-by-block').query({ block: '44A' })
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r) => r.block === '44A')).toBe(true);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/analytics/issues-by-block');
    expect(res.status).toBe(401);
  });

  test('403 for a non-manager role', async () => {
    const res = await request(app)
      .get('/api/analytics/issues-by-block')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/analytics/filter-options', () => {
  test('200 with data-derived blocks and categories', async () => {
    const res = await asManager(request(app).get('/api/analytics/filter-options'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ blocks: ['44A', '88B'], categories: ['Lift', 'Plumbing'] });
  });
});

describe('GET /api/analytics/summary', () => {
  test('200 with KPI values and the vs-prior-period movement', async () => {
    const res = await asManager(request(app).get('/api/analytics/summary'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      open_count: 46,
      overdue_count: 4,
      avg_resolution_hours: 58.3,
      new_last_30: 58,
      new_prior_30: 41,
      sla_threshold_hrs: 72,
    });
    // (58 - 41) / 41 = +41.5%
    expect(res.body.new_records_change_pct).toBeCloseTo(41.5, 1);
    expect(res.body.sla_percentage).toBeCloseTo(76.36, 1);
  });
});

describe('GET /api/analytics/sla-compliance', () => {
  test('ANA-T03: sla_percentage is between 0 and 100', async () => {
    const res = await asManager(request(app).get('/api/analytics/sla-compliance'));

    expect(res.status).toBe(200);
    expect(res.body.sla_percentage).toBeGreaterThanOrEqual(0);
    expect(res.body.sla_percentage).toBeLessThanOrEqual(100);
    expect(res.body).toMatchObject({
      compliant_count: 42,
      total_resolved: 55,
      sla_threshold_hrs: 72,
    });
    // 42/55 = 76.36%
    expect(res.body.sla_percentage).toBeCloseTo(76.36, 1);
  });
});

describe('GET /api/analytics/trends', () => {
  test('200 with daily counts', async () => {
    const res = await asManager(request(app).get('/api/analytics/trends'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { date: '2026-06-24', count: 3 },
      { date: '2026-06-25', count: 6 },
    ]);
  });
});

describe('GET /api/analytics/contractor-scorecard', () => {
  test('200 with per-contractor metrics', async () => {
    const res = await asManager(request(app).get('/api/analytics/contractor-scorecard'));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      contractor: 'KONE Pte Ltd',
      jobs: 11,
      overdue_count: 0,
    });
  });
});

describe('GET /api/analytics/priority-queue', () => {
  test('200 with composite-scored rows', async () => {
    const res = await asManager(request(app).get('/api/analytics/priority-queue'));

    expect(res.status).toBe(200);
    expect(res.body.data[0].composite_score).toBe(71.4);
    expect(res.body.data[0]).toHaveProperty('title');
    expect(res.body.data[0]).toHaveProperty('block');
  });

  test('?priority and ?status are passed into the SQL as parameters', async () => {
    mockQuery.mockClear();
    const res = await asManager(
      request(app)
        .get('/api/analytics/priority-queue')
        .query({ priority: 'Critical', status: 'Open' })
    );

    expect(res.status).toBe(200);
    const queueCall = mockQuery.mock.calls.find(([sql]) => /composite_score/i.test(sql));
    expect(queueCall[0]).toMatch(/i\.priority = \$/);
    expect(queueCall[0]).toMatch(/i\.status = \$/);
    expect(queueCall[1]).toEqual(expect.arrayContaining(['Critical', 'Open']));
  });
});
