// Integration tests for the UC-011 admin cost endpoints. The app runs
// in-process (supertest); three boundaries are mocked so the test is
// deterministic and hits no network:
//   - config/env:      dummy values so config validation passes at boot
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:       SQL-routed mock standing in for Postgres
// Verifies the admin-only guard, the exact response contract Hasini's charts
// consume, and the aggregation maths against known mocked rows.
'use strict';

// --- Mock: env. Dummy values for boot. ---
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
}));

// --- Mock: Supabase auth. Token string maps to claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      const subs = {
        'admin-token': 'admin-1',
        'manager-token': 'mgr-1',
        'resident-token': 'res-1',
        'suspended-admin-token': 'admin-2',
      };
      if (subs[token]) {
        return { data: { claims: { sub: subs[token], email: `${subs[token]}@example.com` } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: the pg layer, routed by SQL. ---
const profiles = {
  'admin-1': { role: 'admin', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
  'admin-2': { role: 'admin', status: 'suspended' },
};

// Aggregates the controller would get back from Postgres. Values are
// hand-checkable: actual 3000 vs projected 3600 -> variance +20.0%.
let dbRows;

function resetDbRows() {
  dbRows = {
    summaryActual: [{ total_actual: 3000 }],
    summaryProjected: [{ total_projected: 3600 }],
    byCategory: [
      { category: 'Doors', actual: 2000, projected: 2400 },
      { category: 'Lift', actual: 1000, projected: 0 },
      // present only in ai_predictions — no closed job in this category yet
      { category: 'Electrical', actual: 0, projected: 1200 },
    ],
    byBlock: [
      { block: '44A', actual: 2000, projected: 2400 },
      { block: '44B', actual: 1000, projected: 1200 },
    ],
    byContractor: [
      { name: 'Otis Service SG', total: 2000, count: 3 },
      { name: 'Schindler', total: 1000, count: 1 },
    ],
    // What Postgres returns once a filter narrows the same query — fewer rows,
    // smaller sums, lower counts. Used to prove filtered numbers reach the
    // response rather than the unfiltered set being served regardless.
    summaryActualFiltered: [{ total_actual: 1200 }],
    summaryProjectedFiltered: [{ total_projected: 900 }],
    byContractorFiltered: [{ name: 'Otis Service SG', total: 1200, count: 2 }],
    // Six months as Postgres would return them: the series is gap-filled in
    // SQL, so 2026-04 is a real 0 row rather than a missing month.
    trends: [
      { month: '2026-02', actual: 1000, projected: 0 },
      { month: '2026-03', actual: 1500, projected: 500 },
      { month: '2026-04', actual: 0, projected: 0 },
      { month: '2026-05', actual: 2000, projected: 0 },
      { month: '2026-06', actual: 2500, projected: 1200 },
      { month: '2026-07', actual: 800, projected: 2400 },
    ],
  };
}
resetDbRows();

const mockQuery = jest.fn(async (sql, params = []) => {
  // requireRole
  if (/SELECT role, status FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // summary — two separate single-row aggregates. Unfiltered calls bind no
  // params, so a non-empty params array means a filter was applied.
  if (/SUM\(actual_cost\)::float AS total_actual/i.test(sql)) {
    return { rows: params.length ? dbRows.summaryActualFiltered : dbRows.summaryActual };
  }
  if (/SUM\(estimated_cost\)::float AS total_projected/i.test(sql)) {
    // A FALSE clause means the filter is unattributable to a prediction.
    if (/\bFALSE\b/.test(sql)) return { rows: [{ total_projected: null }] };
    return { rows: params.length ? dbRows.summaryProjectedFiltered : dbRows.summaryProjected };
  }
  // trends — matched before the breakdown shapes; its CTEs also contain GROUP BY
  if (/generate_series/i.test(sql)) {
    return { rows: dbRows.trends };
  }
  // breakdown — the contractor join is checked before the generic UNION shape
  if (/JOIN contractors c/i.test(sql)) {
    return { rows: params.length ? dbRows.byContractorFiltered : dbRows.byContractor };
  }
  if (/GROUP BY category/i.test(sql)) {
    return { rows: dbRows.byCategory };
  }
  if (/GROUP BY block/i.test(sql)) {
    return { rows: dbRows.byBlock };
  }
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  pool: { connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })) },
  testConnection: jest.fn(),
  query: mockQuery,
}));

const request = require('supertest');
const app = require('../../src/app');

beforeEach(() => {
  jest.clearAllMocks();
  resetDbRows();
});

// Both endpoints share one guard (router.use in routes/admin.js), so the
// access-control matrix is asserted against both.
describe.each([
  ['/api/admin/costs/summary'],
  ['/api/admin/costs/breakdown'],
  ['/api/admin/costs/trends'],
])('%s — access control', (path) => {
  test('401 without a token', async () => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('401 with an invalid token', async () => {
    const res = await request(app).get(path).set('Authorization', 'Bearer nonsense');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('403 for a manager', async () => {
    const res = await request(app).get(path).set('Authorization', 'Bearer manager-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('403 for a resident', async () => {
    const res = await request(app).get(path).set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('403 for an admin whose account is suspended', async () => {
    const res = await request(app).get(path).set('Authorization', 'Bearer suspended-admin-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('200 for an admin', async () => {
    const res = await request(app).get(path).set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/admin/costs/summary', () => {
  const get = () =>
    request(app).get('/api/admin/costs/summary').set('Authorization', 'Bearer admin-token');

  test('returns exactly the contract keys with the correct aggregation', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    // "exactly" — no extra keys leak into the contract Hasini codes against.
    expect(Object.keys(res.body).sort()).toEqual(['total_actual', 'total_projected', 'variance_pct']);
    // 3000 actual, 3600 projected -> (3600-3000)/3000 = +20.0%
    expect(res.body).toEqual({ total_actual: 3000, total_projected: 3600, variance_pct: 20 });
  });

  test('every value is a JavaScript Number, not a string', async () => {
    const res = await get();
    expect(typeof res.body.total_actual).toBe('number');
    expect(typeof res.body.total_projected).toBe('number');
    expect(typeof res.body.variance_pct).toBe('number');
  });

  test('sums closed inspections and active predictions only', async () => {
    await get();
    const [actualSql] = mockQuery.mock.calls.find(([sql]) => /total_actual/i.test(sql));
    const [projectedSql] = mockQuery.mock.calls.find(([sql]) => /total_projected/i.test(sql));

    expect(actualSql).toMatch(/FROM inspections/i);
    expect(actualSql).toMatch(/status = 'Closed'/i);
    expect(actualSql).toMatch(/is_deleted = FALSE/i);
    expect(projectedSql).toMatch(/FROM ai_predictions/i);
    expect(projectedSql).toMatch(/status = 'Active'/i);
  });

  test('NULL sums (no data at all) become 0 and variance_pct null', async () => {
    dbRows.summaryActual = [{ total_actual: null }];
    dbRows.summaryProjected = [{ total_projected: null }];

    const res = await get();
    expect(res.body).toEqual({ total_actual: 0, total_projected: 0, variance_pct: null });
  });

  test('variance_pct is null when there is no actual spend to divide by', async () => {
    dbRows.summaryActual = [{ total_actual: 0 }];

    const res = await get();
    expect(res.body.total_projected).toBe(3600);
    expect(res.body.variance_pct).toBeNull();
  });

  test('variance_pct is negative when projected exposure is below actual spend', async () => {
    dbRows.summaryProjected = [{ total_projected: 2400 }];

    const res = await get();
    // (2400 - 3000) / 3000 = -20.0%
    expect(res.body.variance_pct).toBe(-20);
  });

  test('variance_pct is rounded to one decimal place', async () => {
    dbRows.summaryActual = [{ total_actual: 3000 }];
    dbRows.summaryProjected = [{ total_projected: 3712 }];

    const res = await get();
    // (3712 - 3000) / 3000 = 23.7333... -> 23.7
    expect(res.body.variance_pct).toBe(23.7);
  });

  test('numeric strings from pg are coerced to Numbers', async () => {
    // Belt-and-braces: NUMERIC arrives as a string if a ::float cast is ever
    // dropped from the SQL. The contract must still hand Chart.js numbers.
    dbRows.summaryActual = [{ total_actual: '3000.00' }];
    dbRows.summaryProjected = [{ total_projected: '3600.00' }];

    const res = await get();
    expect(res.body).toEqual({ total_actual: 3000, total_projected: 3600, variance_pct: 20 });
  });
});

describe('GET /api/admin/costs/breakdown', () => {
  const get = () =>
    request(app).get('/api/admin/costs/breakdown').set('Authorization', 'Bearer admin-token');

  test('returns exactly the three contract arrays', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['byBlock', 'byCategory', 'byContractor']);
    expect(Array.isArray(res.body.byCategory)).toBe(true);
    expect(Array.isArray(res.body.byBlock)).toBe(true);
    expect(Array.isArray(res.body.byContractor)).toBe(true);
  });

  test('byCategory rows are exactly { category, actual, projected }', async () => {
    const res = await get();

    expect(res.body.byCategory).toEqual([
      { category: 'Doors', actual: 2000, projected: 2400 },
      { category: 'Lift', actual: 1000, projected: 0 },
      { category: 'Electrical', actual: 0, projected: 1200 },
    ]);
    res.body.byCategory.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(['actual', 'category', 'projected']);
      expect(typeof row.actual).toBe('number');
      expect(typeof row.projected).toBe('number');
    });
  });

  test('byBlock rows are exactly { block, actual, projected }', async () => {
    const res = await get();

    expect(res.body.byBlock).toEqual([
      { block: '44A', actual: 2000, projected: 2400 },
      { block: '44B', actual: 1000, projected: 1200 },
    ]);
    res.body.byBlock.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(['actual', 'block', 'projected']);
      expect(typeof row.actual).toBe('number');
      expect(typeof row.projected).toBe('number');
    });
  });

  test('byContractor rows are exactly { name, total, count }', async () => {
    const res = await get();

    expect(res.body.byContractor).toEqual([
      { name: 'Otis Service SG', total: 2000, count: 3 },
      { name: 'Schindler', total: 1000, count: 1 },
    ]);
    res.body.byContractor.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(['count', 'name', 'total']);
      expect(typeof row.total).toBe('number');
      expect(typeof row.count).toBe('number');
    });
  });

  test('numeric strings from pg are coerced to Numbers in every array', async () => {
    dbRows.byCategory = [{ category: 'Doors', actual: '2000.00', projected: '2400.00' }];
    dbRows.byBlock = [{ block: '44A', actual: '2000.00', projected: null }];
    dbRows.byContractor = [{ name: 'Otis Service SG', total: '2000.00', count: '3' }];

    const res = await get();
    expect(res.body.byCategory[0]).toEqual({ category: 'Doors', actual: 2000, projected: 2400 });
    // NULL projected (a group with no active alerts) becomes 0, not null
    expect(res.body.byBlock[0]).toEqual({ block: '44A', actual: 2000, projected: 0 });
    expect(res.body.byContractor[0]).toEqual({ name: 'Otis Service SG', total: 2000, count: 3 });
  });

  test('empty tables yield empty arrays, not an error', async () => {
    dbRows.byCategory = [];
    dbRows.byBlock = [];
    dbRows.byContractor = [];

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ byCategory: [], byBlock: [], byContractor: [] });
  });

  test('aggregation is done in SQL with GROUP BY, not in JavaScript', async () => {
    await get();
    const grouped = mockQuery.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => /GROUP BY/i.test(sql));

    // one per breakdown: category, block, contractor
    expect(grouped).toHaveLength(3);
    expect(grouped.some((sql) => /GROUP BY category/i.test(sql))).toBe(true);
    expect(grouped.some((sql) => /GROUP BY block/i.test(sql))).toBe(true);
    expect(grouped.some((sql) => /GROUP BY c\.name/i.test(sql))).toBe(true);
  });

  test('category and block breakdowns union both cost sources', async () => {
    await get();
    const categorySql = mockQuery.mock.calls.map(([s]) => s).find((s) => /GROUP BY category/i.test(s));
    const blockSql = mockQuery.mock.calls.map(([s]) => s).find((s) => /GROUP BY block/i.test(s));

    for (const sql of [categorySql, blockSql]) {
      expect(sql).toMatch(/UNION ALL/i);
      expect(sql).toMatch(/FROM inspections/i);
      expect(sql).toMatch(/FROM ai_predictions/i);
    }
    expect(blockSql).toMatch(/location_block AS block/i);
  });

  test('a 500 from the database surfaces as the standard error shape', async () => {
    mockQuery.mockImplementationOnce(async (sql, params = []) => {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    });
    mockQuery.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });

    const res = await get();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'SERVER_ERROR', message: 'connection lost' });
  });
});

describe('GET /api/admin/costs/trends', () => {
  const get = (qs = '') =>
    request(app).get(`/api/admin/costs/trends${qs}`).set('Authorization', 'Bearer admin-token');

  const trendSql = () =>
    mockQuery.mock.calls.find(([sql]) => /generate_series/i.test(sql));

  test('returns { data: [{ month, actual, projected }] } spanning multiple months', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(res.body.data).toHaveLength(6);
    expect(res.body.data).toEqual([
      { month: '2026-02', actual: 1000, projected: 0 },
      { month: '2026-03', actual: 1500, projected: 500 },
      { month: '2026-04', actual: 0, projected: 0 },
      { month: '2026-05', actual: 2000, projected: 0 },
      { month: '2026-06', actual: 2500, projected: 1200 },
      { month: '2026-07', actual: 800, projected: 2400 },
    ]);
  });

  test('rows carry exactly the contract keys, all Numbers, month as YYYY-MM', async () => {
    const res = await get();

    res.body.data.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(['actual', 'month', 'projected']);
      expect(typeof row.actual).toBe('number');
      expect(typeof row.projected).toBe('number');
      expect(row.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    });
  });

  test('months are ordered oldest first and are contiguous — no gaps', async () => {
    const res = await get();
    const months = res.body.data.map((r) => r.month);

    expect([...months].sort()).toEqual(months);
    for (let i = 1; i < months.length; i++) {
      const [py, pm] = months[i - 1].split('-').map(Number);
      const [cy, cm] = months[i].split('-').map(Number);
      expect(cy * 12 + cm - (py * 12 + pm)).toBe(1); // exactly one month apart
    }
  });

  test('a month with no activity is a real 0 row, not a hole', async () => {
    const res = await get();
    const april = res.body.data.find((r) => r.month === '2026-04');

    expect(april).toEqual({ month: '2026-04', actual: 0, projected: 0 });
  });

  test('the month series and gap fill are built in SQL, not JavaScript', async () => {
    await get();
    const [sql] = trendSql();

    expect(sql).toMatch(/generate_series/i);
    expect(sql).toMatch(/LEFT JOIN/i);
    expect(sql).toMatch(/COALESCE\(a\.total, 0\)/i);
    expect(sql).toMatch(/COALESCE\(p\.total, 0\)/i);
    expect(sql).toMatch(/ORDER BY m\.month_start/i);
  });

  // Params are [endDate, startDate, months, ...filter values] — the bounds CTEs
  // come first in the statement, so their placeholders are allocated first.
  test('defaults to a 12-month window', async () => {
    await get();
    const [, params] = trendSql();

    expect(params).toEqual([null, null, 12]);
  });

  test('?months=6 narrows the window and is passed as a bound parameter', async () => {
    await get('?months=6');
    const [sql, params] = trendSql();

    expect(params).toEqual([null, null, 6]);
    // bound, not interpolated — no raw value in the SQL text
    expect(sql).toMatch(/\$3::int/);
    expect(sql).not.toMatch(/make_interval\(months => 6/);
  });

  test.each([1, 12, 24])('accepts the boundary value months=%i', async (months) => {
    const res = await get(`?months=${months}`);

    expect(res.status).toBe(200);
    expect(trendSql()[1]).toEqual([null, null, months]);
  });

  test.each([
    ['0', 'below the minimum'],
    ['25', 'above the maximum'],
    ['-6', 'negative'],
    ['6.5', 'not an integer'],
    ['6o', 'a typo'],
    ['abc', 'not a number'],
  ])('400 VALIDATION_ERROR when months=%s is %s', async (months) => {
    const res = await get(`?months=${months}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/months must be an integer between 1 and 24/);
    // rejected before any query runs
    expect(trendSql()).toBeUndefined();
  });

  test('an empty ?months= falls back to the default rather than erroring', async () => {
    const res = await get('?months=');

    expect(res.status).toBe(200);
    expect(trendSql()[1]).toEqual([null, null, 12]);
  });

  test('pulls actual only from closed, non-deleted inspections', async () => {
    await get();
    const [sql] = trendSql();

    expect(sql).toMatch(/FROM inspections i/i);
    expect(sql).toMatch(/i\.status = 'Closed'/i);
    expect(sql).toMatch(/i\.is_deleted = FALSE/i);
    expect(sql).toMatch(/i\.actual_cost IS NOT NULL/i);
    expect(sql).toMatch(/date_trunc\('month', i\.closed_at\)/i);
  });

  test('pulls projected only from active AI alerts', async () => {
    await get();
    const [sql] = trendSql();

    expect(sql).toMatch(/FROM ai_predictions p/i);
    expect(sql).toMatch(/p\.status = 'Active'/i);
    expect(sql).toMatch(/p\.estimated_cost IS NOT NULL/i);
    expect(sql).toMatch(/date_trunc\('month', p\.created_at\)/i);
  });

  test('an empty database yields an empty array, not an error', async () => {
    dbRows.trends = [];

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  test('NULL and string cost values become Numbers, never null or NaN', async () => {
    dbRows.trends = [
      { month: '2026-06', actual: null, projected: null },
      { month: '2026-07', actual: '2500.00', projected: '1200.50' },
    ];

    const res = await get();
    expect(res.body.data).toEqual([
      { month: '2026-06', actual: 0, projected: 0 },
      { month: '2026-07', actual: 2500, projected: 1200.5 },
    ]);
    res.body.data.forEach((row) => {
      expect(Number.isFinite(row.actual)).toBe(true);
      expect(Number.isFinite(row.projected)).toBe(true);
    });
  });

  test('a non-numeric cost value degrades to 0 rather than NaN', async () => {
    // NaN serialises to null in JSON and breaks Chart.js axis scaling, so the
    // coercion must floor it at 0 instead.
    dbRows.trends = [{ month: '2026-07', actual: 'n/a', projected: undefined }];

    const res = await get();
    expect(res.body.data).toEqual([{ month: '2026-07', actual: 0, projected: 0 }]);
  });

  test('a database failure surfaces as the standard error shape', async () => {
    mockQuery.mockImplementationOnce(async (sql, params = []) => {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    });
    mockQuery.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });

    const res = await get();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'SERVER_ERROR', message: 'connection lost' });
  });
});

// Requirement: never hand the charts null or NaN where a cost is expected.
describe('cost values are never null or NaN', () => {
  test('summary degrades non-numeric sums to 0 and keeps variance_pct safe', async () => {
    dbRows.summaryActual = [{ total_actual: 'not-a-number' }];
    dbRows.summaryProjected = [{ total_projected: undefined }];

    const res = await request(app)
      .get('/api/admin/costs/summary')
      .set('Authorization', 'Bearer admin-token');

    // no actual spend to divide by -> null, not Infinity or NaN
    expect(res.body).toEqual({ total_actual: 0, total_projected: 0, variance_pct: null });
  });

  test('summary survives an empty result set from either aggregate', async () => {
    dbRows.summaryActual = [];
    dbRows.summaryProjected = [];

    const res = await request(app)
      .get('/api/admin/costs/summary')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total_actual: 0, total_projected: 0, variance_pct: null });
  });

  test('breakdown degrades missing group costs to 0', async () => {
    dbRows.byCategory = [{ category: 'Doors', actual: null, projected: 'oops' }];
    dbRows.byBlock = [{ block: '44A', actual: undefined, projected: null }];
    dbRows.byContractor = [{ name: 'Otis Service SG', total: null, count: null }];

    const res = await request(app)
      .get('/api/admin/costs/breakdown')
      .set('Authorization', 'Bearer admin-token');

    expect(res.body.byCategory[0]).toEqual({ category: 'Doors', actual: 0, projected: 0 });
    expect(res.body.byBlock[0]).toEqual({ block: '44A', actual: 0, projected: 0 });
    expect(res.body.byContractor[0]).toEqual({ name: 'Otis Service SG', total: 0, count: 0 });
  });

  test('breakdown SQL coalesces group sums at the database too', async () => {
    await request(app)
      .get('/api/admin/costs/breakdown')
      .set('Authorization', 'Bearer admin-token');

    const grouped = mockQuery.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => /UNION ALL/i.test(sql));

    expect(grouped).toHaveLength(2);
    grouped.forEach((sql) => {
      expect(sql).toMatch(/COALESCE\(SUM\(actual\), 0\)/i);
      expect(sql).toMatch(/COALESCE\(SUM\(projected\), 0\)/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — filtering engine
// ---------------------------------------------------------------------------

const LIFT_ID = '11111111-2222-3333-4444-555555555555';
const CONTRACTOR_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const admin = (path) => request(app).get(path).set('Authorization', 'Bearer admin-token');

// The SQL each endpoint issues against inspections / ai_predictions.
const actualSql = () => mockQuery.mock.calls.find(([s]) => /AS total_actual/i.test(s));
const projectedSql = () => mockQuery.mock.calls.find(([s]) => /AS total_projected/i.test(s));
const contractorSql = () => mockQuery.mock.calls.find(([s]) => /JOIN contractors c/i.test(s));
const unionSql = () => mockQuery.mock.calls.filter(([s]) => /UNION ALL/i.test(s));
const trendsSql = () => mockQuery.mock.calls.find(([s]) => /generate_series/i.test(s));

describe('filters — validation', () => {
  // Every endpoint shares parseFilters, so the matrix runs against all three.
  const PATHS = [
    '/api/admin/costs/summary',
    '/api/admin/costs/breakdown',
    '/api/admin/costs/trends',
  ];

  const BAD = [
    ['startDate=2026-1-1', /startDate must be a real calendar date/],
    ['startDate=01-01-2026', /startDate must be a real calendar date/],
    ['startDate=2026-02-30', /startDate must be a real calendar date/],   // impossible day
    ['startDate=2026-13-01', /startDate must be a real calendar date/],   // impossible month
    ['startDate=yesterday', /startDate must be a real calendar date/],
    ['endDate=2026-06-31', /endDate must be a real calendar date/],       // June has 30 days
    ['liftId=not-a-uuid', /liftId must be a valid UUID/],
    ['liftId=123', /liftId must be a valid UUID/],
    ['contractorId=aaaaaaaa-bbbb-cccc-dddd', /contractorId must be a valid UUID/],
    ['startDate=2026-06-01&endDate=2026-05-01', /startDate must not be after endDate/],
    ['block=44A&block=44B', /block must be provided at most once/],
    [`block=${'x'.repeat(21)}`, /block must be at most 20 characters/],
  ];

  describe.each(PATHS)('%s', (path) => {
    test.each(BAD)('400 VALIDATION_ERROR for ?%s', async (qs, messageRe) => {
      const res = await admin(`${path}?${qs}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toMatch(messageRe);
    });

    test('rejects before touching the database', async () => {
      await admin(`${path}?liftId=nope`);
      const costQueries = mockQuery.mock.calls.filter(
        ([sql]) => !/SELECT role, status FROM users/i.test(sql)
      );
      expect(costQueries).toHaveLength(0);
    });

    test('accepts an equal startDate and endDate (single-day window)', async () => {
      const res = await admin(`${path}?startDate=2026-06-01&endDate=2026-06-01`);
      expect(res.status).toBe(200);
    });

    test('blank filter values are ignored, not treated as errors', async () => {
      const res = await admin(`${path}?startDate=&block=&liftId=&contractorId=`);
      expect(res.status).toBe(200);
    });

    test('unknown query params are ignored', async () => {
      const res = await admin(`${path}?bogus=1&category=Doors`);
      expect(res.status).toBe(200);
    });
  });

  test('a lowercase and an uppercase UUID are both accepted', async () => {
    const upper = await admin(`/api/admin/costs/summary?liftId=${LIFT_ID.toUpperCase()}`);
    const lower = await admin(`/api/admin/costs/summary?liftId=${LIFT_ID}`);

    expect(upper.status).toBe(200);
    expect(lower.status).toBe(200);
  });
});

describe('filters — applied individually', () => {
  test('block only: bound on both cost sources', async () => {
    await admin('/api/admin/costs/summary?block=44A');

    expect(actualSql()[0]).toMatch(/location_block = \$1/);
    expect(actualSql()[1]).toEqual(['44A']);
    expect(projectedSql()[0]).toMatch(/location_block = \$1/);
    expect(projectedSql()[1]).toEqual(['44A']);
  });

  test('startDate only: closed_at for actual, created_at for projected', async () => {
    await admin('/api/admin/costs/summary?startDate=2026-03-01');

    expect(actualSql()[0]).toMatch(/closed_at >= \$1::date/);
    expect(actualSql()[1]).toEqual(['2026-03-01']);
    expect(projectedSql()[0]).toMatch(/created_at >= \$1::date/);
    expect(projectedSql()[1]).toEqual(['2026-03-01']);
  });

  test('endDate only: inclusive, via < endDate + 1 day', async () => {
    await admin('/api/admin/costs/summary?endDate=2026-06-30');

    expect(actualSql()[0]).toMatch(/closed_at < \$1::date \+ INTERVAL '1 day'/);
    expect(projectedSql()[0]).toMatch(/created_at < \$1::date \+ INTERVAL '1 day'/);
    expect(actualSql()[1]).toEqual(['2026-06-30']);
  });

  test('liftId only: bound on inspections, projections suppressed', async () => {
    await admin(`/api/admin/costs/summary?liftId=${LIFT_ID}`);

    expect(actualSql()[0]).toMatch(/lift_id = \$1::uuid/);
    expect(actualSql()[1]).toEqual([LIFT_ID]);
    // ai_predictions has no lift_id — the series is zeroed, not left unfiltered
    expect(projectedSql()[0]).toMatch(/\bFALSE\b/);
    expect(projectedSql()[0]).not.toMatch(/lift_id/);
  });

  test('contractorId only: bound on inspections, projections suppressed', async () => {
    await admin(`/api/admin/costs/summary?contractorId=${CONTRACTOR_ID}`);

    expect(actualSql()[0]).toMatch(/contractor_id = \$1::uuid/);
    expect(actualSql()[1]).toEqual([CONTRACTOR_ID]);
    expect(projectedSql()[0]).toMatch(/\bFALSE\b/);
    expect(projectedSql()[0]).not.toMatch(/contractor_id/);
  });

  test('the base data-consistency clauses survive every filter', async () => {
    await admin(`/api/admin/costs/summary?block=44A&startDate=2026-01-01&liftId=${LIFT_ID}`);

    expect(actualSql()[0]).toMatch(/status = 'Closed'/);
    expect(actualSql()[0]).toMatch(/is_deleted = FALSE/);
    expect(actualSql()[0]).toMatch(/actual_cost IS NOT NULL/);
    expect(projectedSql()[0]).toMatch(/status = 'Active'/);
  });

  test('filter values are bound, never interpolated into the SQL text', async () => {
    // A quote-injection attempt must travel as a value, not as SQL.
    const res = await admin("/api/admin/costs/summary?block=44A' OR '1'='1");

    expect(res.status).toBe(200);
    expect(actualSql()[0]).not.toMatch(/OR '1'='1/);
    expect(actualSql()[1]).toEqual(["44A' OR '1'='1"]);
  });
});

describe('filters — combined', () => {
  test('block AND date range: all three bound in statement order', async () => {
    await admin('/api/admin/costs/summary?startDate=2026-01-01&endDate=2026-03-31&block=44A');

    const [sql, params] = actualSql();
    expect(sql).toMatch(/closed_at >= \$1::date/);
    expect(sql).toMatch(/closed_at < \$2::date \+ INTERVAL '1 day'/);
    expect(sql).toMatch(/location_block = \$3/);
    expect(params).toEqual(['2026-01-01', '2026-03-31', '44A']);
  });

  test('block AND contractorId: both on inspections, projections zeroed', async () => {
    await admin(`/api/admin/costs/summary?block=44A&contractorId=${CONTRACTOR_ID}`);

    expect(actualSql()[1]).toEqual(['44A', CONTRACTOR_ID]);
    // the block filter still binds on the prediction side, then FALSE wins
    expect(projectedSql()[1]).toEqual(['44A']);
    expect(projectedSql()[0]).toMatch(/\bFALSE\b/);
  });

  test('every filter at once', async () => {
    await admin(
      `/api/admin/costs/summary?startDate=2026-01-01&endDate=2026-06-30&block=44A` +
        `&liftId=${LIFT_ID}&contractorId=${CONTRACTOR_ID}`
    );

    expect(actualSql()[1]).toEqual([
      '2026-01-01',
      '2026-06-30',
      '44A',
      LIFT_ID,
      CONTRACTOR_ID,
    ]);
  });

  test('breakdown numbers its UNION params across both halves without collision', async () => {
    await admin('/api/admin/costs/breakdown?startDate=2026-01-01&block=44A');

    const unions = unionSql();
    expect(unions).toHaveLength(2); // byCategory + byBlock
    unions.forEach(([sql, params]) => {
      // inspections half uses $1/$2, ai_predictions half uses $3/$4
      expect(sql).toMatch(/closed_at >= \$1::date/);
      expect(sql).toMatch(/location_block = \$2/);
      expect(sql).toMatch(/created_at >= \$3::date/);
      expect(sql).toMatch(/location_block = \$4/);
      expect(params).toEqual(['2026-01-01', '44A', '2026-01-01', '44A']);
    });
  });

  test('byContractor applies the filters with an i. prefix', async () => {
    await admin(`/api/admin/costs/breakdown?block=44A&liftId=${LIFT_ID}`);

    const [sql, params] = contractorSql();
    expect(sql).toMatch(/i\.location_block = \$1/);
    expect(sql).toMatch(/i\.lift_id = \$2::uuid/);
    expect(params).toEqual(['44A', LIFT_ID]);
  });

  test('trends binds filters after the three window params', async () => {
    await admin('/api/admin/costs/trends?block=44A&startDate=2026-01-01&endDate=2026-06-30');

    const [sql, params] = trendsSql();
    // $1 endDate, $2 startDate, $3 months, then the filter values
    expect(params).toEqual([
      '2026-06-30', '2026-01-01', 12,
      '2026-01-01', '2026-06-30', '44A',   // inspections half
      '2026-01-01', '2026-06-30', '44A',   // ai_predictions half
    ]);
    expect(sql).toMatch(/i\.location_block = \$6/);
    expect(sql).toMatch(/p\.location_block = \$9/);
  });

  test('a date range retargets the trend window instead of the months fallback', async () => {
    await admin('/api/admin/costs/trends?startDate=2026-01-01&endDate=2026-03-31');

    const [sql] = trendsSql();
    // the series starts at the startDate month, not months-ago
    expect(sql).toMatch(/date_trunc\('month', \$2::date\)/);
    expect(sql).toMatch(/COALESCE\(\s*date_trunc\('month', \$2::date\)/);
    // and ends at the endDate month rather than today
    expect(sql).toMatch(/date_trunc\('month', COALESCE\(\$1::date, CURRENT_DATE\)\)/);
  });

  test('with no dates the window still falls back to the months interval', async () => {
    await admin('/api/admin/costs/trends?block=44A');

    const [, params] = trendsSql();
    expect(params.slice(0, 3)).toEqual([null, null, 12]);
  });
});

describe('filters — sums and counts change with the filter', () => {
  test('summary totals reflect the filtered query, not the unfiltered one', async () => {
    const all = await admin('/api/admin/costs/summary');
    const filtered = await admin('/api/admin/costs/summary?block=44A');

    expect(all.body).toEqual({ total_actual: 3000, total_projected: 3600, variance_pct: 20 });
    // 1200 actual vs 900 projected -> (900-1200)/1200 = -25.0%
    expect(filtered.body).toEqual({
      total_actual: 1200,
      total_projected: 900,
      variance_pct: -25,
    });
  });

  test('variance_pct is recomputed from the filtered totals', async () => {
    const res = await admin('/api/admin/costs/summary?block=44A');
    const { total_actual, total_projected, variance_pct } = res.body;

    expect(variance_pct).toBeCloseTo(((total_projected - total_actual) / total_actual) * 100, 5);
  });

  test('a liftId filter zeroes total_projected and nulls variance safely', async () => {
    const res = await admin(`/api/admin/costs/summary?liftId=${LIFT_ID}`);

    expect(res.body.total_actual).toBe(1200);
    expect(res.body.total_projected).toBe(0);          // suppressed, not null/NaN
    // (0 - 1200) / 1200 = -100%
    expect(res.body.variance_pct).toBe(-100);
  });

  test('contractor totals and counts both drop when filtered', async () => {
    const all = await admin('/api/admin/costs/breakdown');
    const filtered = await admin(`/api/admin/costs/breakdown?contractorId=${CONTRACTOR_ID}`);

    expect(all.body.byContractor).toEqual([
      { name: 'Otis Service SG', total: 2000, count: 3 },
      { name: 'Schindler', total: 1000, count: 1 },
    ]);
    expect(filtered.body.byContractor).toEqual([
      { name: 'Otis Service SG', total: 1200, count: 2 },
    ]);
  });

  test('a filter matching nothing yields zeros, not nulls', async () => {
    dbRows.summaryActualFiltered = [{ total_actual: null }];
    dbRows.summaryProjectedFiltered = [{ total_projected: null }];

    const res = await admin('/api/admin/costs/summary?block=NOPE');

    expect(res.body).toEqual({ total_actual: 0, total_projected: 0, variance_pct: null });
  });

  test('the unfiltered response is unchanged from Phase 2 (no regression)', async () => {
    const res = await admin('/api/admin/costs/summary');

    expect(res.body).toEqual({ total_actual: 3000, total_projected: 3600, variance_pct: 20 });
    expect(actualSql()[1]).toEqual([]); // no params bound when nothing is filtered
  });
});

describe('route mounting', () => {
  test('the UC-012 vendor router is not shadowed by the /api/admin mount', async () => {
    // /api/admin/vendors must still reach vendorController, not 404 inside the
    // cost router. A manager is rejected there by the vendor router's own guard.
    const res = await request(app)
      .get('/api/admin/vendors')
      .set('Authorization', 'Bearer manager-token');
    expect(res.status).toBe(403);
  });

  test('an unknown admin path still 404s', async () => {
    const res = await request(app)
      .get('/api/admin/costs/nope')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
