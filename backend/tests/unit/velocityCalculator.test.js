// Unit tests for the UC-006 velocity-calculator foundation. Uses a mocked
// db.query (no live Supabase connection). Covers the formula, eligibility rule,
// zero-baseline policy, pg type coercion, input validation, DB failure
// handling, and SQL safety/correctness.
'use strict';

const { calculateVelocity } = require('../../src/utils/velocityCalculator');

// Fixed clock so window boundaries are deterministic.
const AS_OF = new Date('2026-07-15T00:00:00.000Z');
const OPTS = { asOf: AS_OF };

// Build a db mock whose query() resolves the two aggregate counts.
function mockDb(count_last_30, count_prior_30) {
  return {
    query: jest.fn(async () => ({
      rows: [{ count_last_30, count_prior_30 }],
    })),
  };
}

describe('calculateVelocity — formula', () => {
  test('rising pattern: 5 current vs 2 prior -> +150%', async () => {
    const db = mockDb(5, 2);
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(res).toEqual({
      count_last_30: 5,
      count_prior_30: 2,
      velocity_pct: 150,
      is_eligible: true,
      reason: null,
    });
  });

  test('no change: equal counts -> 0%', async () => {
    const db = mockDb(4, 4);
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(res.velocity_pct).toBe(0);
    expect(res.is_eligible).toBe(true);
  });

  test('decline: eligible current with larger prior -> negative %', async () => {
    const db = mockDb(3, 6);
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(res.velocity_pct).toBe(-50);
    expect(res.is_eligible).toBe(true);
  });

  test('velocity_pct is rounded to two decimals and is a number', async () => {
    const db = mockDb(5, 3); // 66.666... -> 66.67
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(res.velocity_pct).toBe(66.67);
    expect(typeof res.velocity_pct).toBe('number');
  });
});

describe('calculateVelocity — eligibility', () => {
  test('insufficient current data (<3) is ineligible with stable reason', async () => {
    const db = mockDb(2, 1);
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(res.is_eligible).toBe(false);
    expect(res.reason).toBe('INSUFFICIENT_CURRENT_DATA');
    // safe value, below the later >= 40 alert threshold
    expect(res.velocity_pct).toBe(0);
    expect(res.count_last_30).toBe(2);
  });
});

describe('calculateVelocity — zero-baseline policy', () => {
  test('zero prior with eligible current -> finite 100 (no Infinity/NaN)', async () => {
    const db = mockDb(4, 0);
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(res.velocity_pct).toBe(100);
    expect(Number.isFinite(res.velocity_pct)).toBe(true);
    expect(res.is_eligible).toBe(true);
  });

  test('both counts zero -> 0 (ineligible, no division by zero)', async () => {
    const db = mockDb(0, 0);
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(res.velocity_pct).toBe(0);
    expect(Number.isFinite(res.velocity_pct)).toBe(true);
    expect(res.is_eligible).toBe(false);
  });
});

describe('calculateVelocity — PostgreSQL return types', () => {
  test('numeric string counts are converted to JS numbers', async () => {
    // pg returns COUNT(*) as strings.
    const db = mockDb('5', '2');
    const res = await calculateVelocity('44A', 'Lift', db, OPTS);

    expect(typeof res.count_last_30).toBe('number');
    expect(typeof res.count_prior_30).toBe('number');
    expect(res.count_last_30).toBe(5);
    expect(res.count_prior_30).toBe(2);
    expect(res.velocity_pct).toBe(150);
    expect(typeof res.velocity_pct).toBe('number');
  });
});

describe('calculateVelocity — input validation (before any query)', () => {
  test('rejects blank/non-string block without querying', async () => {
    const db = mockDb(5, 2);
    await expect(calculateVelocity('   ', 'Lift', db, OPTS)).rejects.toThrow(/block/);
    await expect(calculateVelocity(null, 'Lift', db, OPTS)).rejects.toThrow(/block/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects blank/non-string category without querying', async () => {
    const db = mockDb(5, 2);
    await expect(calculateVelocity('44A', '', db, OPTS)).rejects.toThrow(/category/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejects an invalid db dependency', async () => {
    await expect(calculateVelocity('44A', 'Lift', {}, OPTS)).rejects.toThrow(/query/);
    await expect(calculateVelocity('44A', 'Lift', null, OPTS)).rejects.toThrow(/query/);
  });

  test('rejects an invalid asOf date without querying', async () => {
    const db = mockDb(5, 2);
    await expect(
      calculateVelocity('44A', 'Lift', db, { asOf: new Date('not-a-date') })
    ).rejects.toThrow(/asOf/);
    await expect(
      calculateVelocity('44A', 'Lift', db, { asOf: '2026-07-15' })
    ).rejects.toThrow(/asOf/);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('calculateVelocity — database failure', () => {
  test('rejects with useful context and does not leak SQL/credentials', async () => {
    const db = {
      query: jest.fn(async () => {
        throw new Error('connection refused');
      }),
    };
    await expect(calculateVelocity('44A', 'Lift', db, OPTS)).rejects.toThrow(
      /database query failed: connection refused/
    );
  });
});

describe('calculateVelocity — SQL safety and correctness', () => {
  test('block and category are passed as bound params, never interpolated', async () => {
    const db = mockDb(5, 2);
    await calculateVelocity('44A', 'Lift', db, OPTS);

    const [sql, params] = db.query.mock.calls[0];
    // values appear in params, not baked into the SQL text
    expect(params[0]).toBe('44A');
    expect(params[1]).toBe('Lift');
    expect(sql).not.toContain('44A');
    expect(sql).not.toContain('Lift');
    expect(sql).toMatch(/location_block = \$1/);
    expect(sql).toMatch(/category = \$2/);
  });

  // Closed records must stay in both windows. is_deleted is TRUE on every Closed
  // record (the two close paths are its only writers), so filtering it here hid
  // all rectified history — the very thing velocity measures.
  test('closed records are counted, not filtered out', async () => {
    const db = mockDb(5, 2);
    await calculateVelocity('44A', 'Lift', db, OPTS);

    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/is_deleted/);
  });

  test('the two 30-day windows are non-overlapping and half-open', async () => {
    const db = mockDb(5, 2);
    await calculateVelocity('44A', 'Lift', db, OPTS);

    const [, params] = db.query.mock.calls[0];
    const [, , currentStart, asOfIso, priorStart] = params;

    const DAY = 24 * 60 * 60 * 1000;
    // asOf boundary
    expect(asOfIso).toBe(AS_OF.toISOString());
    // current window is exactly 30 days ending at asOf
    expect(new Date(asOfIso) - new Date(currentStart)).toBe(30 * DAY);
    // prior window is exactly the preceding 30 days
    expect(new Date(currentStart) - new Date(priorStart)).toBe(30 * DAY);
    // shared boundary (currentStart) means the halves cannot double-count:
    // prior uses [priorStart, currentStart) and current uses [currentStart, asOf)
    expect(new Date(priorStart) < new Date(currentStart)).toBe(true);
    expect(new Date(currentStart) < new Date(asOfIso)).toBe(true);
  });

  test('only one query round trip is made', async () => {
    const db = mockDb(5, 2);
    await calculateVelocity('44A', 'Lift', db, OPTS);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
