// Tests for the UC-011 cost aggregation — filtering, summary/variance windows,
// grouping, trend gap-fill, forecast, top mover, and the lift watchlist.
// Run with `npm test` (vitest). Uses small fixed fixtures, not the demo mocks,
// so expected values are hand-checkable.
import { describe, expect, test } from 'vitest';
import {
  addMonth,
  filterRows,
  summarize,
  groupTotals,
  buildTrend,
  forecastNext,
  backtestForecast,
  topMover,
  contractorBenchmarks,
  buildInsights,
  buildLiftWatchlist,
  LIFT_REPLACEMENT_REVIEW_COST,
} from './costService';

const JOBS = [
  { id: 1, closed_at: '2026-03-10', block: '44A', category: 'Doors',      lift: 'L1', contractor: 'Otis',      actual_cost: 100 },
  { id: 2, closed_at: '2026-04-05', block: '44A', category: 'Doors',      lift: 'L1', contractor: 'Otis',      actual_cost: 200 },
  { id: 3, closed_at: '2026-04-20', block: '44B', category: 'Electrical', lift: 'L2', contractor: 'Dymatics',  actual_cost: 300 },
  { id: 4, closed_at: '2026-06-01', block: '44B', category: 'Doors',      lift: null, contractor: 'Otis',      actual_cost: 400 },
];

describe('filterRows', () => {
  test('date range is inclusive on both ends', () => {
    const rows = filterRows(JOBS, { from: '2026-04-05', to: '2026-04-20' });
    expect(rows.map((r) => r.id)).toEqual([2, 3]);
  });

  test('block / category / contractor are exact matches; empty filters ignored', () => {
    expect(filterRows(JOBS, { block: '44A' })).toHaveLength(2);
    expect(filterRows(JOBS, { category: 'Doors', contractor: 'Otis' })).toHaveLength(3);
    expect(filterRows(JOBS, {})).toHaveLength(4);
  });
});

describe('summarize', () => {
  const PREDICTIONS = [
    { block: '44A', category: 'Doors', estimated_cost: 500 },
    { block: '44B', category: 'Electrical', estimated_cost: 700 },
  ];

  test('totals actual over the filtered rows and projected over matching predictions', () => {
    const s = summarize(JOBS, PREDICTIONS, { block: '44A' });
    expect(s.total_actual).toBe(300); // jobs 1 + 2
    expect(s.total_projected).toBe(500); // only the 44A prediction
    expect(s.jobs).toBe(2);
  });

  test('variance compares the window against the equally long prior window', () => {
    // Window Apr 1–30 → jobs 2+3 = 500. Prior window Mar 1(ish)–Mar 31 → job 1 = 100.
    const s = summarize(JOBS, [], { from: '2026-04-01', to: '2026-04-30' });
    expect(s.prior_actual).toBe(100);
    expect(s.variance_pct).toBe(400); // (500 - 100) / 100
  });

  test('a job on the window start date is not double-counted into the prior window', () => {
    // Window starts exactly on job 2's close date; prior window must end Apr 4.
    const s = summarize(JOBS, [], { from: '2026-04-05', to: '2026-05-04' });
    expect(s.total_actual).toBe(500); // jobs 2 + 3
    expect(s.prior_actual).toBe(100); // job 1 only — job 2 excluded from prior
  });

  test('variance is null when the prior window had no spend', () => {
    const s = summarize(JOBS, [], { from: '2026-03-01', to: '2026-03-31' });
    expect(s.variance_pct).toBeNull();
  });
});

describe('groupTotals', () => {
  test('groups and sorts cost-heaviest first', () => {
    const rows = groupTotals(JOBS, 'category');
    expect(rows).toEqual([
      { category: 'Doors', actual_cost: 700, jobs: 3 },
      { category: 'Electrical', actual_cost: 300, jobs: 1 },
    ]);
  });
});

describe('buildTrend', () => {
  test('one point per month, gap months filled with zero', () => {
    const trend = buildTrend(JOBS);
    expect(trend.map((t) => t.month)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    expect(trend[1]).toEqual({ month: '2026-04', actual_cost: 500, jobs: 2 });
    expect(trend[2]).toEqual({ month: '2026-05', actual_cost: 0, jobs: 0 }); // gap month
  });
});

describe('addMonth / forecastNext', () => {
  test('addMonth rolls over year boundaries', () => {
    expect(addMonth('2026-12')).toBe('2027-01');
    expect(addMonth('2026-01', -1)).toBe('2025-12');
  });

  const month = (m, cost) => ({ month: m, actual_cost: cost, jobs: 1 });

  test('a flat history projects flat, with a zero-width band', () => {
    const trend = [month('2026-01', 100), month('2026-02', 100), month('2026-03', 100)];
    const f = forecastNext(trend, { currentMonth: '2026-04' });
    expect(f.points.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    for (const p of f.points) {
      expect(p.value).toBe(100);
      expect(p.lower).toBe(100); // perfect in-sample fit → no error spread
      expect(p.upper).toBe(100);
    }
  });

  test('a rising history keeps rising, but damped — each step gains less', () => {
    const trend = [
      month('2026-01', 100), month('2026-02', 200), month('2026-03', 300),
      month('2026-04', 400), month('2026-05', 500),
    ];
    const [p1, p2, p3] = forecastNext(trend, { currentMonth: '2026-06' }).points;
    expect(p1.value).toBeGreaterThan(500); // continues upward
    // Damping: each successive forecast step gains less than the one before.
    const step2 = p2.value - p1.value;
    const step3 = p3.value - p2.value;
    expect(step2).toBeGreaterThan(0);
    expect(step3).toBeGreaterThan(0);
    expect(step3).toBeLessThan(step2);
  });

  test('excludes the partial current month from the fit but projects past it', () => {
    // June is the current month (partial, artificially low): the fit must use
    // Jan–May only, and the first projected point lands on July, not June.
    const trend = [
      month('2026-01', 100), month('2026-02', 200), month('2026-03', 300),
      month('2026-04', 400), month('2026-05', 500), month('2026-06', 50),
    ];
    const f = forecastNext(trend, { currentMonth: '2026-06' });
    expect(f.points[0].month).toBe('2026-07');
    expect(f.points[0].value).toBeGreaterThan(500); // not dragged down by June
  });

  test('a declining trend clamps at zero, never negative', () => {
    const trend = [month('2026-01', 300), month('2026-02', 150), month('2026-03', 0)];
    for (const p of forecastNext(trend, { currentMonth: '2026-04' }).points) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.lower).toBeGreaterThanOrEqual(0);
    }
  });

  test('the uncertainty band widens with the horizon on noisy data', () => {
    const trend = [
      month('2026-01', 100), month('2026-02', 300), month('2026-03', 140),
      month('2026-04', 320), month('2026-05', 160),
    ];
    const [p1, , p3] = forecastNext(trend, { currentMonth: '2026-06' }).points;
    expect(p3.upper - p3.lower).toBeGreaterThan(p1.upper - p1.lower);
  });

  test('needs at least three complete months of history', () => {
    expect(forecastNext(buildTrend(JOBS.slice(0, 2)), { currentMonth: '2026-12' })).toBeNull();
    // Three months on the chart but one is the partial current month → null.
    const trend = [month('2026-01', 100), month('2026-02', 200), month('2026-03', 300)];
    expect(forecastNext(trend, { currentMonth: '2026-03' })).toBeNull();
  });
});

describe('backtestForecast', () => {
  const month = (m, cost) => ({ month: m, actual_cost: cost, jobs: 1 });

  test('a flat history backtests with zero error', () => {
    const trend = [
      month('2026-01', 100), month('2026-02', 100), month('2026-03', 100),
      month('2026-04', 100), month('2026-05', 100),
    ];
    const b = backtestForecast(trend, { currentMonth: '2026-06' });
    // Apr and May each have ≥3 prior complete months to fit on.
    expect(b.rows.map((r) => r.month)).toEqual(['2026-04', '2026-05']);
    for (const r of b.rows) {
      expect(r.predicted).toBe(100);
      expect(r.actual).toBe(100);
      expect(r.error_pct).toBe(0);
    }
    expect(b.mape).toBe(0);
  });

  test('never peeks: each month is predicted from strictly earlier data', () => {
    // A sudden June spike must NOT influence the prediction FOR June — the
    // fit for June sees only Jan–May (all 100s), so it predicts ~100.
    const trend = [
      month('2026-01', 100), month('2026-02', 100), month('2026-03', 100),
      month('2026-04', 100), month('2026-05', 100), month('2026-06', 1000),
    ];
    const b = backtestForecast(trend, { currentMonth: '2026-07' });
    const june = b.rows.find((r) => r.month === '2026-06');
    expect(june.predicted).toBe(100);
    expect(june.error_pct).toBe(-90); // predicted 100 vs actual 1000
  });

  test('skips zero-spend months and excludes the partial current month', () => {
    const trend = [
      month('2026-01', 100), month('2026-02', 100), month('2026-03', 100),
      month('2026-04', 0), // gap month — % error undefined, skipped
      month('2026-05', 100),
      month('2026-06', 40), // partial current month — never graded
    ];
    const b = backtestForecast(trend, { currentMonth: '2026-06' });
    expect(b.rows.map((r) => r.month)).toEqual(['2026-05']);
  });

  test('null when no month has three complete months before it', () => {
    const trend = [month('2026-01', 100), month('2026-02', 100), month('2026-03', 100)];
    expect(backtestForecast(trend, { currentMonth: '2026-04' })).toBeNull();
  });
});

describe('topMover', () => {
  test('finds the biggest month-on-month category increase', () => {
    const rows = [
      { closed_at: '2026-05-01', category: 'Doors', actual_cost: 100 },
      { closed_at: '2026-06-01', category: 'Doors', actual_cost: 150 }, // +50%
      { closed_at: '2026-05-01', category: 'Electrical', actual_cost: 100 },
      { closed_at: '2026-06-01', category: 'Electrical', actual_cost: 300 }, // +200%
    ];
    const m = topMover(rows);
    expect(m.category).toBe('Electrical');
    expect(m.pct).toBe(200);
    expect(m.month).toBe('2026-06');
  });

  test('ignores the partial current month — compares the last two complete months', () => {
    const rows = [
      { closed_at: '2026-05-01', category: 'Doors', actual_cost: 100 },
      { closed_at: '2026-06-01', category: 'Doors', actual_cost: 200 }, // +100% (last complete pair)
      { closed_at: '2026-07-01', category: 'Doors', actual_cost: 10 }, // partial month — must not count
    ];
    const m = topMover(rows, { currentMonth: '2026-07' });
    expect(m.month).toBe('2026-06');
    expect(m.pct).toBe(100);
  });

  test('null when nothing increased or there is only one month', () => {
    expect(topMover(JOBS.slice(0, 1))).toBeNull();
    const flat = [
      { closed_at: '2026-05-01', category: 'Doors', actual_cost: 200 },
      { closed_at: '2026-06-01', category: 'Doors', actual_cost: 100 },
    ];
    expect(topMover(flat)).toBeNull();
  });
});

describe('contractorBenchmarks', () => {
  const job = (contractor, category, cost) => ({
    closed_at: '2026-06-01', block: '44A', category, contractor, actual_cost: cost,
  });

  test('flags a contractor charging well above peers within the same category', () => {
    const rows = [
      job('Pricey', 'Doors', 200), job('Pricey', 'Doors', 200),
      job('PeerA', 'Doors', 100), job('PeerA', 'Doors', 100),
      job('PeerB', 'Doors', 100), job('PeerB', 'Doors', 100),
    ];
    const flags = contractorBenchmarks(rows);
    expect(flags.Pricey).toEqual({ category: 'Doors', deviation_pct: 100 });
    // PeerA: avg 100 vs peers' (200+200+100+100)/4 = 150 → −33%, flagged cheap.
    expect(flags.PeerA.deviation_pct).toBeLessThan(0);
  });

  test('compares within categories only — cheap-category specialists are not "cheaper"', () => {
    // X does only expensive Mechanical, Y only cheap Lighting. Overall
    // averages differ wildly, but neither deviates within its own category
    // (no peers there), so nothing is flagged.
    const rows = [
      job('X', 'Mechanical', 1500), job('X', 'Mechanical', 1500),
      job('Y', 'Lighting', 100), job('Y', 'Lighting', 100),
    ];
    expect(contractorBenchmarks(rows)).toEqual({});
  });

  test('needs ≥2 own jobs and ≥2 peer jobs, and ≥15% deviation', () => {
    const oneJob = [
      job('Solo', 'Doors', 500), // one job — not enough evidence
      job('PeerA', 'Doors', 100), job('PeerB', 'Doors', 100),
    ];
    expect(contractorBenchmarks(oneJob).Solo).toBeUndefined();
    const nearPeers = [
      job('Fair', 'Doors', 110), job('Fair', 'Doors', 110),
      job('PeerA', 'Doors', 100), job('PeerB', 'Doors', 100),
    ];
    expect(contractorBenchmarks(nearPeers).Fair).toBeUndefined(); // +10% < 15%
  });
});

describe('buildInsights', () => {
  const base = {
    summary: { total_actual: 1000, total_projected: 0, variance_pct: 10, jobs: 4, prior_actual: 900 },
    byCategory: [{ category: 'Doors', actual_cost: 700, jobs: 2 }],
    byContractor: [
      { contractor: 'Otis', actual_cost: 600, jobs: 2 },
      { contractor: 'Other', actual_cost: 400, jobs: 2 },
    ],
  };

  test('headline states spend, job count, and movement', () => {
    const [head] = buildInsights(base);
    expect(head).toBe('Maintenance spend is $1,000.00 across 4 closed jobs, up 10% on the prior period.');
  });

  test('concentration sentence only appears at ≥40% share', () => {
    expect(buildInsights(base).some((s) => s.includes('Otis accounts for 60%'))).toBe(true);
    const spread = {
      ...base,
      byContractor: [
        { contractor: 'Otis', actual_cost: 300, jobs: 1 },
        { contractor: 'Other', actual_cost: 700, jobs: 3 },
      ],
    };
    expect(buildInsights(spread).some((s) => s.includes('accounts for 30%'))).toBe(false);
  });

  test('mover folds into the top-category sentence when they match', () => {
    const withMover = { ...base, mover: { category: 'Doors', pct: 41, month: '2026-06', cost: 0, prev_cost: 0 } };
    expect(buildInsights(withMover).some((s) => s.includes('costliest category') && s.includes('rose 41%'))).toBe(true);
  });

  test('flags the most urgent watchlist lift', () => {
    const withLift = { ...base, lifts: [{ lift: 'L44A-01', months_to_review: 4, pct_of_threshold: 80 }] };
    expect(buildInsights(withLift).some((s) => s.includes('L44A-01') && s.includes('about 4 months'))).toBe(true);
  });

  test('silent when there are no jobs in view', () => {
    expect(buildInsights({ summary: { jobs: 0 } })).toEqual([]);
  });
});

describe('buildLiftWatchlist', () => {
  test('sums lifetime spend per lift, skipping non-lift jobs', () => {
    const pct = Math.round((300 / LIFT_REPLACEMENT_REVIEW_COST) * 100);
    const lifts = buildLiftWatchlist(JOBS, { currentMonth: '2026-07' });
    // L1: $300 lifetime, $300 in the last 6 complete months → $50/mo rate →
    // (8000 − 300) / 50 = 154 months to the review threshold.
    expect(lifts).toEqual([
      { lift: 'L1', block: '44A', actual_cost: 300, jobs: 2, pct_of_threshold: pct, months_to_review: 154 },
      { lift: 'L2', block: '44B', actual_cost: 300, jobs: 1, pct_of_threshold: pct, months_to_review: 154 },
    ]);
  });

  test('months_to_review: 0 past the threshold, null with no recent spend', () => {
    const past = [{ closed_at: '2026-01-05', block: '44A', category: 'Doors', lift: 'LX', contractor: 'Otis', actual_cost: 9000 }];
    expect(buildLiftWatchlist(past, { currentMonth: '2026-07' })[0].months_to_review).toBe(0);
    // Spend exists but none inside the 6-month rate window → no rate → null.
    const stale = [{ closed_at: '2025-06-05', block: '44A', category: 'Doors', lift: 'LY', contractor: 'Otis', actual_cost: 4000 }];
    expect(buildLiftWatchlist(stale, { currentMonth: '2026-07' })[0].months_to_review).toBeNull();
  });

  test('applies the block filter but no date filters (lifetime by design)', () => {
    expect(buildLiftWatchlist(JOBS, { block: '44B', currentMonth: '2026-07' })).toHaveLength(1);
  });
});
