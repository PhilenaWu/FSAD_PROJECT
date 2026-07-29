// UC-011 admin operational cost analytics — summary KPIs and grouped
// breakdowns. Admin-only (guard applied in routes/admin.js). Raw SQL on
// `inspections` (actual spend, set at close in UC-004) and `ai_predictions`
// (projected exposure from active UC-006 risk alerts).
//
// Every numeric field is returned as a JavaScript Number, never a string:
// pg returns NUMERIC as a string, so each SUM is cast (::float / ::int) in SQL
// and passed through num() on the way out. Chart.js silently renders string
// values as zero, so this is a contract guarantee, not a nicety.
'use strict';

const { query } = require('../config/db');

// Coerce any cost value to a finite Number. SUM over an empty set is NULL and a
// missing group is 0 spend, not "unknown"; anything that cannot be read as a
// number (undefined, '', a stray non-numeric string) also becomes 0 rather than
// reaching the frontend as NaN, which serialises to `null` in JSON and breaks
// Chart.js axis scaling.
const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// Trend window bounds: how many months of history /costs/trends may return.
const TREND_MONTHS_DEFAULT = 12;
const TREND_MONTHS_MIN = 1;
const TREND_MONTHS_MAX = 24;

// inspections.location_block / ai_predictions.location_block are VARCHAR(20).
const BLOCK_MAX_LEN = 20;

// inspections.category / ai_predictions.category are VARCHAR(50).
const CATEGORY_MAX_LEN = 50;

// ---------------------------------------------------------------------------
// Filter parsing and validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Real calendar date, not just the right shape — the round trip rejects
// 2026-02-30 and 2026-13-01, which a regex alone would happily accept.
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Validate the shared cost filters. Returns { filters } or { error: message }.
// Every value is validated here, before any SQL runs, so a malformed UUID
// surfaces as a 400 rather than a Postgres cast error dressed up as a 500.
const FILTER_NAMES = ['startDate', 'endDate', 'block', 'category', 'liftId', 'contractorId'];

function parseFilters(reqQuery) {
  const filters = {};

  for (const name of FILTER_NAMES) {
    const raw = reqQuery[name];
    if (raw === undefined) continue;
    // Express hands back an array when a param is repeated (?block=A&block=B).
    // Silently taking one of them would quietly show the admin the wrong data.
    if (typeof raw !== 'string') {
      return { error: `${name} must be provided at most once.` };
    }
    const trimmed = raw.trim();
    if (trimmed !== '') filters[name] = trimmed;
  }

  for (const name of ['startDate', 'endDate']) {
    if (filters[name] && !isRealDate(filters[name])) {
      return { error: `${name} must be a real calendar date in YYYY-MM-DD format.` };
    }
  }
  // Safe as a string compare: both are validated YYYY-MM-DD, which sorts
  // lexicographically the same way it sorts chronologically.
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    return { error: 'startDate must not be after endDate.' };
  }

  for (const name of ['liftId', 'contractorId']) {
    if (filters[name] && !UUID_RE.test(filters[name])) {
      return { error: `${name} must be a valid UUID.` };
    }
  }

  if (filters.block && filters.block.length > BLOCK_MAX_LEN) {
    return { error: `block must be at most ${BLOCK_MAX_LEN} characters.` };
  }

  if (filters.category && filters.category.length > CATEGORY_MAX_LEN) {
    return { error: `category must be at most ${CATEGORY_MAX_LEN} characters.` };
  }

  return { filters };
}

// ---------------------------------------------------------------------------
// Dynamic WHERE building
// ---------------------------------------------------------------------------

// Accumulates bound values and hands out the matching $n placeholder. Filter
// values are NEVER interpolated into SQL text — add() is the only way in.
// Callers must append clauses in the same order they appear in the statement
// so the $n numbering lines up.
function paramBag(initial = []) {
  const values = [...initial];
  return {
    values,
    add(v) {
      values.push(v);
      return `$${values.length}`;
    },
  };
}

// WHERE fragment selecting closed, costed inspections, narrowed by whichever
// filters are set. `p` is a column prefix ('' or 'i.').
//
// Deliberately NOT filtered on is_deleted. That flag is written in exactly two
// places — the manual close (UC-004) and the G6 zero-defect auto-file — so it
// means "archived out of the active queues", not "deleted", and it is TRUE for
// every Closed record. Pairing it with status = 'Closed' is unsatisfiable and
// silently returned $0 across the whole dashboard.
function inspectionWhere(filters, bag, p = '') {
  const clauses = [
    `${p}status = 'Closed'`,
    `${p}actual_cost IS NOT NULL`,
  ];

  // Actual spend is dated by when the money was settled.
  if (filters.startDate) {
    clauses.push(`${p}closed_at >= ${bag.add(filters.startDate)}::date`);
  }
  if (filters.endDate) {
    // Inclusive end date: anything closed on the endDate day still counts.
    // Matches the convention in analyticsController.buildFilters.
    clauses.push(`${p}closed_at < ${bag.add(filters.endDate)}::date + INTERVAL '1 day'`);
  }
  if (filters.block) {
    clauses.push(`${p}location_block = ${bag.add(filters.block)}`);
  }
  if (filters.category) {
    clauses.push(`${p}category = ${bag.add(filters.category)}`);
  }
  if (filters.liftId) {
    clauses.push(`${p}lift_id = ${bag.add(filters.liftId)}::uuid`);
  }
  if (filters.contractorId) {
    clauses.push(`${p}contractor_id = ${bag.add(filters.contractorId)}::uuid`);
  }

  return clauses.join(' AND ');
}

// WHERE fragment selecting active, costed AI alerts, narrowed by the filters
// that ai_predictions can actually honour.
//
// ai_predictions (migration 010) has location_block and category only — no
// lift_id, no contractor_id. When either of those filters is set the projected
// series is suppressed to zero rather than left unfiltered: showing estate-wide
// projected exposure next to one lift's actual spend invites exactly the wrong
// conclusion, and inventing an attribution would be worse still.
function predictionWhere(filters, bag, p = '') {
  const clauses = [`${p}status = 'Active'`, `${p}estimated_cost IS NOT NULL`];

  // Projected exposure is dated by when the alert was raised.
  if (filters.startDate) {
    clauses.push(`${p}created_at >= ${bag.add(filters.startDate)}::date`);
  }
  if (filters.endDate) {
    clauses.push(`${p}created_at < ${bag.add(filters.endDate)}::date + INTERVAL '1 day'`);
  }
  if (filters.block) {
    clauses.push(`${p}location_block = ${bag.add(filters.block)}`);
  }
  if (filters.category) {
    clauses.push(`${p}category = ${bag.add(filters.category)}`);
  }
  if (filters.liftId || filters.contractorId) {
    clauses.push('FALSE'); // not attributable — see above
  }

  return clauses.join(' AND ');
}

// True when the filters make the projected series unattributable, so callers
// and tests can reason about it without re-deriving the rule.
function projectionsSuppressed(filters) {
  return Boolean(filters.liftId || filters.contractorId);
}

// ---------------------------------------------------------------------------
// Data fetchers (exported so a later PDF/PPT export can reuse the same numbers)
// ---------------------------------------------------------------------------

// { total_actual, total_projected, variance_pct, jobs }
// variance_pct is how far projected exposure sits above (+) or below (-)
// actual spend to date, to 1 dp. Null when there is no actual spend to compare
// against — a percentage of zero is undefined, and the UI shows "—" rather
// than a fabricated figure.
// `jobs` is how many closed, costed records the total is made of — the KPI tile
// states it alongside the money, and the dashboard divides by it for average
// cost per job, so it must come from the same WHERE as the SUM.
async function fetchCostSummary(filters = {}) {
  const actualBag = paramBag();
  const actual = await query(
    `SELECT SUM(actual_cost)::float AS total_actual,
            COUNT(*)::int          AS jobs
       FROM inspections
      WHERE ${inspectionWhere(filters, actualBag)}`,
    actualBag.values
  );

  const projectedBag = paramBag();
  const projected = await query(
    `SELECT SUM(estimated_cost)::float AS total_projected
       FROM ai_predictions
      WHERE ${predictionWhere(filters, projectedBag)}`,
    projectedBag.values
  );

  const total_actual = num(actual.rows[0]?.total_actual);
  const total_projected = num(projected.rows[0]?.total_projected);

  return {
    total_actual,
    total_projected,
    variance_pct:
      total_actual > 0
        ? Number((((total_projected - total_actual) / total_actual) * 100).toFixed(1))
        : null,
    jobs: num(actual.rows[0]?.jobs),
  };
}

// Actual and projected side by side for one dimension shared by both tables
// (`category`, or `location_block` aliased to `block`). UNION ALL + one
// GROUP BY keeps a group that exists on only one side — a category with an
// active alert but no closed jobs yet still appears, with actual 0.
async function fetchBreakdownBy(dimension, alias, filters = {}) {
  // One bag for both halves of the UNION: the inspections clause is written
  // first in the statement, so its params must be added first.
  const bag = paramBag();
  const inspections = inspectionWhere(filters, bag);
  const predictions = predictionWhere(filters, bag);

  const { rows } = await query(
    `SELECT ${alias},
            COALESCE(SUM(actual), 0)::float    AS actual,
            COALESCE(SUM(projected), 0)::float AS projected
       FROM (
         SELECT ${dimension} AS ${alias}, actual_cost AS actual, 0 AS projected
           FROM inspections
          WHERE ${inspections}
         UNION ALL
         SELECT ${dimension} AS ${alias}, 0 AS actual, estimated_cost AS projected
           FROM ai_predictions
          WHERE ${predictions}
       ) combined
      GROUP BY ${alias}
      ORDER BY SUM(actual) DESC`,
    bag.values
  );

  return rows.map((r) => ({
    [alias]: r[alias],
    actual: num(r.actual),
    projected: num(r.projected),
  }));
}

// [{ name, total, count }] — spend per contractor, costliest first. Actual only:
// ai_predictions carries no contractor, so there is no projected figure to give.
async function fetchCostByContractor(filters = {}) {
  const bag = paramBag();
  const { rows } = await query(
    `SELECT c.name          AS name,
            SUM(i.actual_cost)::float AS total,
            COUNT(*)::int   AS count
       FROM inspections i
       JOIN contractors c ON c.id = i.contractor_id
      WHERE ${inspectionWhere(filters, bag, 'i.')}
      GROUP BY c.name
      ORDER BY SUM(i.actual_cost) DESC`,
    bag.values
  );

  return rows.map((r) => ({
    name: r.name,
    total: num(r.total),
    count: num(r.count),
  }));
}

// [{ month, actual, projected }] — one row per calendar month for the last
// `months` months, oldest first, ending with the current month.
//
// The month series is generated in SQL (generate_series over month starts) and
// LEFT JOINed to the two cost sources, so a month with no activity comes back
// as a real 0 row instead of a hole the chart has to patch. Doing the gap fill
// in JavaScript would mean re-deriving the calendar in two places.
//
// `actual` is dated by inspections.closed_at — when the money was settled.
// `projected` is dated by ai_predictions.created_at — when the alert was
// raised. Active alerts are open exposure *now* and have no historical month of
// their own, so this is the only honest dating available; see the note in the
// data contract.
async function fetchCostTrends(months = TREND_MONTHS_DEFAULT, filters = {}) {
  // Params must be added in statement order: the bounds CTEs come first.
  const bag = paramBag();
  const endParam = bag.add(filters.endDate ?? null);
  const startParam = bag.add(filters.startDate ?? null);
  const monthsParam = bag.add(months);
  const inspections = inspectionWhere(filters, bag, 'i.');
  const predictions = predictionWhere(filters, bag, 'p.');

  const { rows } = await query(
    `WITH last AS (
       SELECT date_trunc('month', COALESCE(${endParam}::date, CURRENT_DATE)) AS last_start
     ),
     bounds AS (
       -- A date range defines the window when given; otherwise fall back to the
       -- trailing months-wide window ending on the current month.
       SELECT l.last_start,
              COALESCE(
                date_trunc('month', ${startParam}::date),
                l.last_start - make_interval(months => ${monthsParam}::int - 1)
              ) AS first_start
         FROM last l
     ),
     months AS (
       SELECT generate_series(b.first_start, b.last_start, INTERVAL '1 month') AS month_start
         FROM bounds b
     ),
     actual AS (
       SELECT date_trunc('month', i.closed_at) AS month_start,
              SUM(i.actual_cost) AS total
         FROM inspections i, bounds b
        WHERE ${inspections}
          AND i.closed_at >= b.first_start
        GROUP BY 1
     ),
     projected AS (
       SELECT date_trunc('month', p.created_at) AS month_start,
              SUM(p.estimated_cost) AS total
         FROM ai_predictions p, bounds b
        WHERE ${predictions}
          AND p.created_at >= b.first_start
        GROUP BY 1
     )
     SELECT to_char(m.month_start, 'YYYY-MM')  AS month,
            COALESCE(a.total, 0)::float        AS actual,
            COALESCE(p.total, 0)::float        AS projected
       FROM months m
       LEFT JOIN actual    a ON a.month_start = m.month_start
       LEFT JOIN projected p ON p.month_start = m.month_start
      ORDER BY m.month_start`,
    bag.values
  );

  return rows.map((r) => ({
    month: r.month,
    actual: num(r.actual),
    projected: num(r.projected),
  }));
}

// { byCategory, byBlock, byContractor }
async function fetchCostBreakdown(filters = {}) {
  const byCategory = await fetchBreakdownBy('category', 'category', filters);
  const byBlock = await fetchBreakdownBy('location_block', 'block', filters);
  const byContractor = await fetchCostByContractor(filters);
  return { byCategory, byBlock, byContractor };
}

// [{ id, closed_at, block, category, lift, contractor, actual_cost }] — the
// job-level rows behind every aggregate, newest close first. The dashboard's
// drill-down table, CSV export, monthly trend, repair-vs-replace watchlist and
// contractor price benchmarks are all derived from these rows, so this is the
// one place the filters and the row shape have to agree.
//
// closed_at is formatted as YYYY-MM-DD in SQL rather than shipped as a
// timestamp: the client groups and compares these values as plain strings
// (month keys, date-range bounds), and a raw timestamp would re-introduce
// timezone drift on the way through JSON.
//
// contractor is NULL for a record closed without an assignment (an in-house
// fix); it is labelled rather than dropped so the row still totals correctly.
// lift stays NULL for estate defects that are not tied to a lift — the
// watchlist skips those rows rather than inventing an asset for them.
async function fetchCostJobs(filters = {}) {
  const bag = paramBag();
  const { rows } = await query(
    `SELECT i.id,
            to_char(i.closed_at, 'YYYY-MM-DD') AS closed_at,
            i.location_block                   AS block,
            i.category,
            l.lift_code                        AS lift,
            COALESCE(c.name, 'Unassigned')     AS contractor,
            i.actual_cost::float               AS actual_cost
       FROM inspections i
       LEFT JOIN lifts l       ON l.id = i.lift_id
       LEFT JOIN contractors c ON c.id = i.contractor_id
      WHERE ${inspectionWhere(filters, bag, 'i.')}
      ORDER BY i.closed_at DESC`,
    bag.values
  );

  return rows.map((r) => ({
    id: r.id,
    closed_at: r.closed_at,
    block: r.block,
    category: r.category,
    lift: r.lift,
    contractor: r.contractor,
    actual_cost: num(r.actual_cost),
  }));
}

// { blocks, categories, contractors: [{ id, name }] } for the filter bar.
//
// Options are drawn from the costed rows themselves, not from the full
// reference tables: an option that cannot match anything would send the admin
// to an empty dashboard and leave them wondering which of the two is broken.
// No filters are applied — the dropdowns must not narrow themselves out of the
// values needed to undo the current selection.
async function fetchCostFilterOptions() {
  // No filters, so no bound values — inspectionWhere still supplies the single
  // definition of "a costed row" that every other query here uses.
  const costed = inspectionWhere({}, paramBag());
  const costedPrefixed = inspectionWhere({}, paramBag(), 'i.');

  const blocks = await query(
    `SELECT DISTINCT location_block AS value
       FROM inspections WHERE ${costed} ORDER BY value`
  );
  const categories = await query(
    `SELECT DISTINCT category AS value
       FROM inspections WHERE ${costed} ORDER BY value`
  );
  const contractors = await query(
    `SELECT DISTINCT c.id, c.name
       FROM inspections i
       JOIN contractors c ON c.id = i.contractor_id
      WHERE ${costedPrefixed}
      ORDER BY c.name`
  );

  return {
    blocks: blocks.rows.map((r) => r.value),
    categories: categories.rows.map((r) => r.value),
    contractors: contractors.rows.map((r) => ({ id: r.id, name: r.name })),
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const validationError = (res, message) =>
  res.status(400).json({ code: 'VALIDATION_ERROR', message });

// GET /api/admin/costs/summary?startDate&endDate&block&liftId&contractorId
async function getCostSummary(req, res, next) {
  try {
    const { filters, error } = parseFilters(req.query);
    if (error) return validationError(res, error);

    res.json(await fetchCostSummary(filters));
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/costs/breakdown?startDate&endDate&block&liftId&contractorId
async function getCostBreakdown(req, res, next) {
  try {
    const { filters, error } = parseFilters(req.query);
    if (error) return validationError(res, error);

    res.json(await fetchCostBreakdown(filters));
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/costs/trends?months=12&startDate&endDate&block&liftId&contractorId
// `months` is optional and only applies when no date range is given. Rejecting a
// bad value rather than silently falling back keeps the chart honest: a typo'd
// ?months=6o should not quietly render a 12-month line the admin believes is 6.
async function getCostTrends(req, res, next) {
  try {
    const raw = req.query.months;
    let months = TREND_MONTHS_DEFAULT;

    if (raw !== undefined && raw !== '') {
      months = Number(raw);
      if (
        !Number.isInteger(months) ||
        months < TREND_MONTHS_MIN ||
        months > TREND_MONTHS_MAX
      ) {
        return validationError(
          res,
          `months must be an integer between ${TREND_MONTHS_MIN} and ${TREND_MONTHS_MAX}.`
        );
      }
    }

    const { filters, error } = parseFilters(req.query);
    if (error) return validationError(res, error);

    res.json({ data: await fetchCostTrends(months, filters) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/costs/jobs?startDate&endDate&block&category&liftId&contractorId
async function getCostJobs(req, res, next) {
  try {
    const { filters, error } = parseFilters(req.query);
    if (error) return validationError(res, error);

    res.json({ data: await fetchCostJobs(filters) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/costs/filter-options — takes no parameters.
async function getCostFilterOptions(req, res, next) {
  try {
    res.json(await fetchCostFilterOptions());
  } catch (err) {
    next(err);
  }
}

module.exports = {
  TREND_MONTHS_DEFAULT,
  getCostSummary,
  getCostBreakdown,
  getCostTrends,
  getCostJobs,
  getCostFilterOptions,
  fetchCostSummary,
  fetchCostBreakdown,
  fetchCostTrends,
  fetchCostJobs,
  fetchCostFilterOptions,
  parseFilters,
  projectionsSuppressed,
};
