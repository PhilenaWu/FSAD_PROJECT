// UC-011 admin cost analytics data layer. The aggregation itself lives in
// small pure functions (exported for unit tests) that take raw job rows —
// shaped like the backend's inspections + ai_predictions records — so every
// filter, chart, and KPI is genuinely computed. When the /api/admin/costs
// endpoints (task 5.19a) land, only the async wrappers at the bottom swap
// their data source; the returned shapes already match HLD §6.10.
import { MOCK_COST_JOBS, MOCK_ACTIVE_PREDICTIONS } from '../mocks/costMocks';

// A lift whose lifetime maintenance spend crosses this is flagged for a
// repair-vs-replace review (watchlist panel). Demo policy figure.
export const LIFT_REPLACEMENT_REVIEW_COST = 8000;

const delay = (data) =>
  new Promise((resolve) => setTimeout(() => resolve(data), 250));

const sum = (rows, key) => rows.reduce((acc, r) => acc + r[key], 0);

// "2026-01" + 1 → "2026-02". Pure string/int math — no Date, no timezone.
export function addMonth(month, n = 1) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Pure aggregation (unit-tested in costService.test.js)
// ---------------------------------------------------------------------------

// Filters: { from, to } as YYYY-MM-DD (applied to closed_at, inclusive), plus
// exact-match block / category / contractor. Empty values are ignored.
export function filterRows(rows, { from, to, block, category, contractor } = {}) {
  return rows.filter(
    (j) =>
      (!from || j.closed_at >= from) &&
      (!to || j.closed_at <= to) &&
      (!block || j.block === block) &&
      (!category || j.category === category) &&
      (!contractor || j.contractor === contractor)
  );
}

// Summary: total actual (filtered), projected exposure (active predictions
// matching the block/category filters), and spend movement — the filtered
// window's spend vs the equally long window immediately before it (default
// window: last 90 days). The prior window ends the day BEFORE the current one
// starts so a job closed on the boundary date is never counted twice.
export function summarize(rows, predictions, filters = {}) {
  const jobs = filterRows(rows, filters);

  const matching = predictions.filter(
    (p) =>
      (!filters.block || p.block === filters.block) &&
      (!filters.category || p.category === filters.category)
  );

  const msPerDay = 86_400_000;
  const iso = (d) => d.toISOString().slice(0, 10);
  const to = filters.to ? new Date(`${filters.to}T00:00:00Z`) : new Date();
  const from = filters.from
    ? new Date(`${filters.from}T00:00:00Z`)
    : new Date(to.getTime() - 90 * msPerDay);
  const windowMs = Math.max(to - from, msPerDay);
  const priorFrom = new Date(from.getTime() - windowMs);
  const priorTo = new Date(from.getTime() - msPerDay); // day before `from`

  const windowActual = sum(filterRows(rows, { ...filters, from: iso(from), to: iso(to) }), 'actual_cost');
  const priorActual = sum(filterRows(rows, { ...filters, from: iso(priorFrom), to: iso(priorTo) }), 'actual_cost');
  const variance_pct =
    priorActual > 0
      ? Math.round(((windowActual - priorActual) / priorActual) * 1000) / 10
      : null;

  return {
    total_actual: sum(jobs, 'actual_cost'),
    total_projected: sum(matching, 'estimated_cost'),
    variance_pct,
    jobs: jobs.length,
    prior_actual: priorActual,
  };
}

// Group rows by `key` (e.g. 'category', 'contractor') → totals, cost-heaviest
// first: [{ [key], actual_cost, jobs }].
export function groupTotals(rows, key) {
  const groups = new Map();
  for (const j of rows) {
    const row = groups.get(j[key]) ?? { [key]: j[key], actual_cost: 0, jobs: 0 };
    row.actual_cost += j.actual_cost;
    row.jobs += 1;
    groups.set(j[key], row);
  }
  return [...groups.values()].sort((a, b) => b.actual_cost - a.actual_cost);
}

// Monthly trend — one point per calendar month, interior gap months filled
// with 0 so the line doesn't silently skip quiet months.
export function buildTrend(rows) {
  const byMonth = new Map();
  for (const j of rows) {
    const month = j.closed_at.slice(0, 7);
    const row = byMonth.get(month) ?? { month, actual_cost: 0, jobs: 0 };
    row.actual_cost += j.actual_cost;
    row.jobs += 1;
    byMonth.set(month, row);
  }
  const months = [...byMonth.keys()].sort();
  if (months.length > 1) {
    let cursor = months[0];
    const last = months[months.length - 1];
    while (cursor < last) {
      if (!byMonth.has(cursor)) byMonth.set(cursor, { month: cursor, actual_cost: 0, jobs: 0 });
      cursor = addMonth(cursor);
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// "2026-04" → 24315: months since year 0, for regression x-coordinates.
const monthIndex = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return y * 12 + (mo - 1);
};

// Spend projection: damped-trend exponential smoothing (Holt's method with a
// damping factor) fitted on COMPLETE months only — the current calendar month
// is excluded because its partial total would drag the trend down. Damping
// (PHI < 1) makes the projected trend flatten as the horizon grows, which is
// the standard guard against runaway straight-line extrapolation. Each point
// carries a lower/upper range: ±1.28σ of the model's own one-step-ahead
// errors (≈80% band), widening with the square root of the horizon. Null with
// fewer than 3 complete months — too thin to fit.
const ALPHA = 0.5; // level smoothing
const BETA = 0.3; // trend smoothing
const PHI = 0.85; // trend damping
const Z80 = 1.28; // ~80% normal band

export function forecastNext(trend, { currentMonth, horizon = 3 } = {}) {
  const nowMonth = currentMonth ?? new Date().toISOString().slice(0, 7);
  const history = trend.filter((t) => t.month < nowMonth);
  if (history.length < 3) return null;

  const ys = history.map((t) => t.actual_cost);
  let level = ys[0];
  let slope = ys[1] - ys[0];
  const residuals = [];
  for (let i = 1; i < ys.length; i++) {
    residuals.push(ys[i] - (level + PHI * slope));
    const prevLevel = level;
    level = ALPHA * ys[i] + (1 - ALPHA) * (level + PHI * slope);
    slope = BETA * (level - prevLevel) + (1 - BETA) * PHI * slope;
  }
  const sigma = Math.sqrt(residuals.reduce((a, e) => a + e * e, 0) / residuals.length);
  const r2 = (n) => Math.round(n * 100) / 100;

  // Forecast steps count from the end of the FITTED history, but points are
  // only emitted past the last month on the chart (which may be the partial
  // current month), so the projection continues the visible line.
  const lastFit = monthIndex(history[history.length - 1].month);
  const lastChart = monthIndex(trend[trend.length - 1].month);
  const gap = lastChart - lastFit;
  const points = [];
  let damp = 0;
  for (let h = 1; h <= gap + horizon; h++) {
    damp += PHI ** h;
    if (h <= gap) continue;
    const value = Math.max(0, r2(level + damp * slope));
    const spread = Z80 * sigma * Math.sqrt(h);
    points.push({
      month: addMonth(history[history.length - 1].month, h),
      value,
      lower: Math.max(0, r2(value - spread)),
      upper: r2(value + spread),
    });
  }
  return { points, method: 'damped_trend_exponential_smoothing' };
}

// Walk-forward backtest — the model grades itself on the past. For every
// complete month with at least 3 complete months of history before it, refit
// the forecast on that prior history ONLY (no peeking) and predict the month,
// then compare against what actually happened. Months with zero actual spend
// are skipped (percentage error is undefined against zero). Returns the
// per-month rows plus the mean absolute percentage error, or null when no
// month has enough history to test.
export function backtestForecast(trend, { currentMonth } = {}) {
  const nowMonth = currentMonth ?? new Date().toISOString().slice(0, 7);
  const history = trend.filter((t) => t.month < nowMonth);
  const rows = [];
  for (let i = 3; i < history.length; i++) {
    const fit = forecastNext(history.slice(0, i), {
      currentMonth: history[i].month,
      horizon: 1,
    });
    if (!fit) continue;
    const actual = history[i].actual_cost;
    if (actual <= 0) continue;
    const predicted = fit.points[0].value;
    rows.push({
      month: history[i].month,
      predicted,
      actual,
      error_pct: Math.round(((predicted - actual) / actual) * 1000) / 10,
    });
  }
  if (!rows.length) return null;
  const mape =
    Math.round((rows.reduce((a, r) => a + Math.abs(r.error_pct), 0) / rows.length) * 10) / 10;
  return { rows, mape };
}

// Biggest category cost increase, latest COMPLETE month vs the month before —
// the "top mover" callout. The partial current month is excluded: comparing a
// half-finished month against a full one would flag artificial movements.
// Null when there's no increase or fewer than two complete months.
export function topMover(rows, { currentMonth } = {}) {
  const nowMonth = currentMonth ?? new Date().toISOString().slice(0, 7);
  const months = [...new Set(rows.map((j) => j.closed_at.slice(0, 7)))]
    .filter((m) => m < nowMonth)
    .sort();
  if (months.length < 2) return null;
  const [prevM, lastM] = months.slice(-2);
  const totals = (m) => {
    const byCat = new Map();
    for (const j of rows) {
      if (j.closed_at.slice(0, 7) === m) byCat.set(j.category, (byCat.get(j.category) ?? 0) + j.actual_cost);
    }
    return byCat;
  };
  const prev = totals(prevM);
  const last = totals(lastM);
  let best = null;
  for (const [category, cost] of last) {
    const before = prev.get(category);
    if (!before) continue; // new categories have no meaningful % change
    const pct = Math.round(((cost - before) / before) * 1000) / 10;
    if (pct > 0 && (!best || pct > best.pct)) {
      best = { category, pct, month: lastM, cost, prev_cost: before };
    }
  }
  return best;
}

// Repair-vs-replace watchlist: LIFETIME spend per lift (date filters are
// deliberately ignored — the replacement decision looks at the whole life,
// not the filtered window; block filter still applies). Costliest first.
// months_to_review projects WHEN the lift crosses the review threshold at its
// current spend rate (average over the last 6 complete months): 0 = already
// past it, null = no recent spend to project from.
export function buildLiftWatchlist(rows, { block, currentMonth } = {}) {
  const nowMonth = currentMonth ?? new Date().toISOString().slice(0, 7);
  const rateFrom = addMonth(nowMonth, -6);
  const lifts = new Map();
  for (const j of rows) {
    if (!j.lift) continue; // estate defects not tied to a lift
    if (block && j.block !== block) continue;
    const row =
      lifts.get(j.lift) ??
      { lift: j.lift, block: j.block, actual_cost: 0, jobs: 0, recent_cost: 0 };
    row.actual_cost += j.actual_cost;
    row.jobs += 1;
    const m = j.closed_at.slice(0, 7);
    if (m >= rateFrom && m < nowMonth) row.recent_cost += j.actual_cost;
    lifts.set(j.lift, row);
  }
  return [...lifts.values()]
    .map(({ recent_cost, ...l }) => {
      const monthlyRate = recent_cost / 6;
      let months_to_review = null;
      if (l.actual_cost >= LIFT_REPLACEMENT_REVIEW_COST) {
        months_to_review = 0;
      } else if (monthlyRate > 0) {
        months_to_review = Math.ceil(
          (LIFT_REPLACEMENT_REVIEW_COST - l.actual_cost) / monthlyRate
        );
      }
      return {
        ...l,
        pct_of_threshold: Math.round((l.actual_cost / LIFT_REPLACEMENT_REVIEW_COST) * 100),
        months_to_review,
      };
    })
    .sort((a, b) => b.actual_cost - a.actual_cost);
}

// Contractor price benchmarking: within EACH category, compare a contractor's
// average cost per job against the job-weighted average of its PEERS' jobs in
// that same category (comparing raw overall averages would be confounded by
// job mix — cheap lighting fixes vs costly mechanical overhauls). Flags need
// ≥2 own jobs and ≥2 peer jobs in the category, and a deviation of at least
// ±15% to be worth saying. Returns { [contractor]: { category, deviation_pct } }
// with each contractor's LARGEST deviation, or an entry absent when nothing
// significant was found.
export function contractorBenchmarks(rows) {
  // totals[category][contractor] = { cost, jobs }
  const totals = new Map();
  for (const j of rows) {
    if (!totals.has(j.category)) totals.set(j.category, new Map());
    const byCon = totals.get(j.category);
    const t = byCon.get(j.contractor) ?? { cost: 0, jobs: 0 };
    t.cost += j.actual_cost;
    t.jobs += 1;
    byCon.set(j.contractor, t);
  }

  const flags = {};
  for (const [category, byCon] of totals) {
    for (const [contractor, own] of byCon) {
      if (own.jobs < 2) continue;
      let peerCost = 0;
      let peerJobs = 0;
      for (const [other, t] of byCon) {
        if (other === contractor) continue;
        peerCost += t.cost;
        peerJobs += t.jobs;
      }
      if (peerJobs < 2) continue;
      const ownAvg = own.cost / own.jobs;
      const peerAvg = peerCost / peerJobs;
      const deviation_pct = Math.round(((ownAvg - peerAvg) / peerAvg) * 100);
      if (Math.abs(deviation_pct) < 15) continue;
      const existing = flags[contractor];
      if (!existing || Math.abs(deviation_pct) > Math.abs(existing.deviation_pct)) {
        flags[contractor] = { category, deviation_pct };
      }
    }
  }
  return flags;
}

// "$1,234.56" for insight sentences (page display formatting lives in the
// page; this keeps the generated text self-contained and testable).
const fmt$ = (n) =>
  `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Auto-written executive summary: up to 5 plain-English sentences derived
// from the aggregates by fixed rules (no LLM — deterministic and testable).
// Each rule only speaks when its finding is worth saying.
export function buildInsights({ summary, byCategory = [], byContractor = [], mover, lifts = [], forecast } = {}) {
  const out = [];
  if (!summary || !summary.jobs) return out;

  // 1. Headline spend + movement vs the prior window.
  let head = `Maintenance spend is ${fmt$(summary.total_actual)} across ${summary.jobs} closed job${summary.jobs === 1 ? '' : 's'}`;
  if (summary.variance_pct != null) {
    head += `, ${summary.variance_pct > 0 ? 'up' : 'down'} ${Math.abs(summary.variance_pct)}% on the prior period`;
  }
  out.push(`${head}.`);

  // 2. Spend concentration — only when one contractor dominates (≥40%).
  const topCon = byContractor[0];
  if (topCon && byContractor.length > 1 && summary.total_actual > 0) {
    const share = Math.round((topCon.actual_cost / summary.total_actual) * 100);
    if (share >= 40) {
      out.push(`${topCon.contractor} accounts for ${share}% of all spend (${topCon.jobs} jobs).`);
    }
  }

  // 3. Costliest category, folding in the month-on-month mover when it's the
  //    same category; otherwise the mover gets its own sentence.
  const topCat = byCategory[0];
  if (topCat) {
    if (mover && mover.category === topCat.category) {
      out.push(`${topCat.category} is the costliest category at ${fmt$(topCat.actual_cost)}, and rose ${mover.pct}% in ${mover.month}.`);
    } else {
      out.push(`${topCat.category} is the costliest category at ${fmt$(topCat.actual_cost)}.`);
      if (mover) {
        out.push(`${mover.category} spend rose ${mover.pct}% in ${mover.month} — the largest month-on-month increase.`);
      }
    }
  }

  // 4. The most urgent lift on the repair-vs-replace watchlist.
  const past = lifts.find((l) => l.months_to_review === 0);
  const approaching = lifts.find((l) => l.months_to_review != null && l.months_to_review > 0 && l.months_to_review <= 12);
  if (past) {
    out.push(`${past.lift} has passed the ${fmt$(LIFT_REPLACEMENT_REVIEW_COST)} replacement-review threshold — review recommended.`);
  } else if (approaching) {
    out.push(`At its current spend rate, ${approaching.lift} will reach the replacement-review threshold in about ${approaching.months_to_review} month${approaching.months_to_review === 1 ? '' : 's'}.`);
  }

  // 5. Next month's projection.
  if (forecast?.points?.length) {
    out.push(`Next month's spend is projected at ${fmt$(forecast.points[0].value)}.`);
  }

  return out.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Public API — async wrappers the page calls; each mirrors one backend
// endpoint (or, for lifts/movers, a planned extension of the cost controller).
// ---------------------------------------------------------------------------

export async function getCostFilterOptions() {
  return delay({
    blocks: [...new Set(MOCK_COST_JOBS.map((j) => j.block))].sort(),
    categories: [...new Set(MOCK_COST_JOBS.map((j) => j.category))].sort(),
    contractors: [...new Set(MOCK_COST_JOBS.map((j) => j.contractor))].sort(),
  });
}

// GET /api/admin/costs/summary
export async function getCostSummary(filters = {}) {
  return delay(summarize(MOCK_COST_JOBS, MOCK_ACTIVE_PREDICTIONS, filters));
}

// GET /api/admin/costs/by-category
export async function getCostByCategory(filters = {}) {
  return delay({ data: groupTotals(filterRows(MOCK_COST_JOBS, filters), 'category') });
}

// GET /api/admin/costs/by-contractor
export async function getCostByContractor(filters = {}) {
  return delay({ data: groupTotals(filterRows(MOCK_COST_JOBS, filters), 'contractor') });
}

// GET /api/admin/costs/trend — plus the client-side next-month projection and
// top-mover callout derived from the same filtered rows.
export async function getCostTrend(filters = {}) {
  const rows = filterRows(MOCK_COST_JOBS, filters);
  const data = buildTrend(rows);
  return delay({
    data,
    forecast: forecastNext(data),
    backtest: backtestForecast(data),
    top_mover: topMover(rows),
  });
}

// Job-level rows for the drill-down table / CSV export.
export async function getCostJobs(filters = {}) {
  const data = [...filterRows(MOCK_COST_JOBS, filters)].sort((a, b) =>
    b.closed_at.localeCompare(a.closed_at)
  );
  return delay({ data });
}

// Lifetime spend per lift for the repair-vs-replace watchlist.
export async function getLiftWatchlist(filters = {}) {
  return delay({ data: buildLiftWatchlist(MOCK_COST_JOBS, filters) });
}

// Per-contractor price-vs-peers flags for the contractor table.
export async function getContractorBenchmarks(filters = {}) {
  return delay({ data: contractorBenchmarks(filterRows(MOCK_COST_JOBS, filters)) });
}
