// Unit tests for analytics (UC-005) — ANA-T01…T03 and T06…T13 from the phase
// plan (ANA-T04/T05 are the CSV export, covered in
// frontend/src/pages/DashboardPage.test.jsx because the export is client-side) plus
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
  // Paper-form sections — read from the checklist template, not hardcoded.
  if (/SELECT DISTINCT section AS v FROM checklist_items/i.test(sql)) {
    return { rows: [{ v: 'A — Motor Room' }, { v: 'B — Lift Car' }] };
  }
  // reopen_count column probe (present in this suite so the scorecard
  // exercises the averaging branch).
  if (/information_schema\.columns/i.test(sql)) {
    return { rows: [{ '?column?': 1 }] };
  }
  // KPI summary — first query (counts + windows), then its SLA sub-query.
  // Anchored on "AS open_count": a bare /open_count/ also matches the
  // scorecard's AVG(i.reopen_count) and would hijack that query.
  if (/AS open_count/i.test(sql)) {
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
        { contractor: 'KONE Pte Ltd', jobs: 11, avg_rectification_days: 3.1, repeat_defect_rate: 4.2, overdue_count: 0, avg_reopens: 0.27 },
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

  test('ANA-T06: 401 without a token', async () => {
    const res = await request(app).get('/api/analytics/issues-by-block');
    expect(res.status).toBe(401);
  });

  test('ANA-T06: 403 for a non-manager role', async () => {
    const res = await request(app)
      .get('/api/analytics/issues-by-block')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/analytics/filter-options', () => {
  test('ANA-T07: 200 with data-derived blocks, categories and paper-form sections', async () => {
    const res = await asManager(request(app).get('/api/analytics/filter-options'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      blocks: ['44A', '88B'],
      categories: ['Lift', 'Plumbing'],
      sections: ['A — Motor Room', 'B — Lift Car'],
    });
  });

  test('ANA-T08: sections come from checklist_items, so the paper re-seed needs no code change', async () => {
    mockQuery.mockClear();
    await asManager(request(app).get('/api/analytics/filter-options'));

    const sql = mockQuery.mock.calls.map(([s]) => s).join('\n');
    expect(sql).toMatch(/FROM checklist_items/i);
    expect(sql).toMatch(/active = TRUE/i);
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
  test('ANA-T09: 200 with per-contractor metrics including overdue and re-opens', async () => {
    const res = await asManager(request(app).get('/api/analytics/contractor-scorecard'));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      contractor: 'KONE Pte Ltd',
      jobs: 11,
      overdue_count: 0,
      avg_reopens: 0.27,
    });
  });

  test('ANA-T10: averages reopen_count when the column exists', async () => {
    mockQuery.mockClear();
    await asManager(request(app).get('/api/analytics/contractor-scorecard'));

    const scorecardSql = mockQuery.mock.calls.map(([s]) => s).find((s) => /JOIN contractors/i.test(s));
    expect(scorecardSql).toMatch(/AVG\(i\.reopen_count\)/i);
  });
});

// HLD G11 — a hold pauses the rectification clock, so held records are not
// overdue. The overdue-chase job skips them; if these queries counted them the
// dashboard would contradict the emails the contractor actually receives.
describe('overdue counts respect the On Hold pause (G11)', () => {
  test('ANA-T11: KPI summary excludes On Hold and soft-deleted records', async () => {
    mockQuery.mockClear();
    await asManager(request(app).get('/api/analytics/summary'));

    const [sql] = mockQuery.mock.calls.find(([s]) => /AS open_count/i.test(s));
    const overdue = sql.slice(sql.indexOf('target_deadline'), sql.indexOf('AS overdue_count'));
    expect(overdue).toMatch(/'On Hold'/);
    expect(overdue).toMatch(/is_deleted = FALSE/i);
  });

  test('ANA-T12: contractor scorecard excludes On Hold', async () => {
    mockQuery.mockClear();
    await asManager(request(app).get('/api/analytics/contractor-scorecard'));

    const [sql] = mockQuery.mock.calls.find(([s]) => /JOIN contractors/i.test(s));
    const overdue = sql.slice(sql.indexOf('i.target_deadline'), sql.indexOf('AS overdue_count'));
    expect(overdue).toMatch(/'On Hold'/);
  });
});

// The composite score's frequency term is documented as "per OPEN record
// sharing block+category" — counting resolved history would rank a block that
// used to have problems as urgently as one that has them now.
describe('priority queue frequency term counts open records only', () => {
  test('ANA-T13: the LATERAL subquery filters out Resolved/Closed', async () => {
    mockQuery.mockClear();
    await asManager(request(app).get('/api/analytics/priority-queue'));

    const [sql] = mockQuery.mock.calls.find(([s]) => /composite_score/i.test(s));
    const lateral = sql.slice(sql.indexOf('JOIN LATERAL'), sql.indexOf(') freq'));
    expect(lateral).toMatch(/f\.is_deleted = FALSE/i);
    expect(lateral).toMatch(/f\.status NOT IN \('Resolved', 'Closed'\)/i);
  });
});

// H.2 — filter by the paper form's section (HLD §7.2). "Which part of the
// lift fails most" is a client question ("Statistic / report", R17).
describe('?section filter', () => {
  test('adds an EXISTS over checklist_results scoped to Defect rows', async () => {
    mockQuery.mockClear();
    const res = await asManager(
      request(app).get('/api/analytics/issues-by-block').query({ section: 'A — Motor Room' })
    );

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls.find(([s]) =>
      /GROUP BY location_block, category/i.test(s)
    );
    expect(sql).toMatch(/EXISTS/i);
    expect(sql).toMatch(/JOIN checklist_items/i);
    expect(sql).toMatch(/cr\.result = 'Defect'/i);
    expect(params).toContain('A — Motor Room');
  });

  test('is absent from the SQL when no section is requested', async () => {
    mockQuery.mockClear();
    await asManager(request(app).get('/api/analytics/issues-by-block'));

    const [sql] = mockQuery.mock.calls.find(([s]) =>
      /GROUP BY location_block, category/i.test(s)
    );
    expect(sql).not.toMatch(/checklist_results/i);
  });

  test('the KPI summary honours the section filter like every other panel', async () => {
    mockQuery.mockClear();
    const res = await asManager(
      request(app).get('/api/analytics/summary').query({ section: 'A — Motor Room' })
    );

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls.find(([s]) => /AS open_count/i.test(s));
    expect(sql).toMatch(/EXISTS/i);
    expect(sql).toMatch(/JOIN checklist_items/i);
    expect(params).toContain('A — Motor Room');
  });

  test('joins against the prefixed alias on the scorecard query', async () => {
    mockQuery.mockClear();
    await asManager(
      request(app).get('/api/analytics/contractor-scorecard').query({ section: 'B — Lift Car' })
    );

    const [sql] = mockQuery.mock.calls.find(([s]) => /JOIN contractors/i.test(s));
    // Prefixed callers select FROM inspections i — the subquery must correlate
    // on i.id, not inspections.id, or Postgres cannot resolve the reference.
    expect(sql).toMatch(/cr\.inspection_id = i\.id/i);
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

// ANA-T14: filter validation. Every endpoint binds its filters as SQL
// parameters, which stops injection but not a cast error — Postgres coerces the
// bound value to the column type, so ?from=hello raised SQLSTATE 22007 and
// ?to=2026-13-45 raised 22008. Both surfaced as a 500 quoting the database's
// own message. They are 400s now, and no query runs at all.
describe('ANA-T14: filter validation rejects bad input before any SQL runs', () => {
  test.each([
    ['from=hello', { from: 'hello' }],
    ['to=2026-13-45 (out of range)', { to: '2026-13-45' }],
    ['from=2026-02-30 (not a real date)', { from: '2026-02-30' }],
  ])('400 VALIDATION_ERROR for ?%s', async (_label, params) => {
    mockQuery.mockClear();
    const res = await asManager(request(app).get('/api/analytics/trends').query(params));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    // No cast error can leak if the analytics query never ran. requireRole's
    // profile lookup does run first, so assert on the reporting query rather
    // than on the mock being untouched.
    const analyticsRan = mockQuery.mock.calls.some(([sql]) => /FROM inspections/i.test(sql));
    expect(analyticsRan).toBe(false);
  });

  test('a repeated filter is rejected rather than silently half-applied', async () => {
    const res = await asManager(
      request(app).get('/api/analytics/issues-by-block?block=44A&block=44B')
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at most once/i);
  });

  test('from after to is refused', async () => {
    const res = await asManager(
      request(app).get('/api/analytics/summary').query({ from: '2026-08-01', to: '2026-07-01' })
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must not be after/i);
  });

  test('the guard is mounted on every analytics route, not just one', async () => {
    const routes = [
      'filter-options', 'summary', 'issues-by-block', 'trends',
      'sla-compliance', 'contractor-scorecard', 'priority-queue',
    ];
    for (const route of routes) {
      const res = await asManager(request(app).get(`/api/analytics/${route}?from=hello`));
      expect([route, res.status]).toEqual([route, 400]);
    }
  });

  test('valid dates still pass through and reach the query', async () => {
    mockQuery.mockClear();
    const res = await asManager(
      request(app).get('/api/analytics/trends').query({ from: '2026-01-01', to: '2026-12-31' })
    );

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalled();
  });
});
