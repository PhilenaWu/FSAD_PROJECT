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

// Rows that count as real, settled spend. `is_deleted` records are soft-deleted
// and must not inflate the estate's cost figures.
const CLOSED_SPEND = `status = 'Closed' AND is_deleted = FALSE AND actual_cost IS NOT NULL`;

// Rows that count as projected exposure — UC-006 alerts still awaiting a
// decision. Accepted/Dismissed alerts are no longer open exposure.
const ACTIVE_PROJECTION = `status = 'Active' AND estimated_cost IS NOT NULL`;

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

// ---------------------------------------------------------------------------
// Data fetchers (exported so a later PDF/PPT export can reuse the same numbers)
// ---------------------------------------------------------------------------

// { total_actual, total_projected, variance_pct }
// variance_pct is how far projected exposure sits above (+) or below (-)
// actual spend to date, to 1 dp. Null when there is no actual spend to compare
// against — a percentage of zero is undefined, and the UI shows "—" rather
// than a fabricated figure.
async function fetchCostSummary() {
  const actual = await query(
    `SELECT SUM(actual_cost)::float AS total_actual
       FROM inspections
      WHERE ${CLOSED_SPEND}`
  );
  const projected = await query(
    `SELECT SUM(estimated_cost)::float AS total_projected
       FROM ai_predictions
      WHERE ${ACTIVE_PROJECTION}`
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
  };
}

// Actual and projected side by side for one dimension shared by both tables
// (`category`, or `location_block` aliased to `block`). UNION ALL + one
// GROUP BY keeps a group that exists on only one side — a category with an
// active alert but no closed jobs yet still appears, with actual 0.
async function fetchBreakdownBy(dimension, alias) {
  const { rows } = await query(
    `SELECT ${alias},
            COALESCE(SUM(actual), 0)::float    AS actual,
            COALESCE(SUM(projected), 0)::float AS projected
       FROM (
         SELECT ${dimension} AS ${alias}, actual_cost AS actual, 0 AS projected
           FROM inspections
          WHERE ${CLOSED_SPEND}
         UNION ALL
         SELECT ${dimension} AS ${alias}, 0 AS actual, estimated_cost AS projected
           FROM ai_predictions
          WHERE ${ACTIVE_PROJECTION}
       ) combined
      GROUP BY ${alias}
      ORDER BY SUM(actual) DESC`
  );

  return rows.map((r) => ({
    [alias]: r[alias],
    actual: num(r.actual),
    projected: num(r.projected),
  }));
}

// [{ name, total, count }] — spend per contractor, costliest first. Actual only:
// ai_predictions carries no contractor, so there is no projected figure to give.
async function fetchCostByContractor() {
  const { rows } = await query(
    `SELECT c.name          AS name,
            SUM(i.actual_cost)::float AS total,
            COUNT(*)::int   AS count
       FROM inspections i
       JOIN contractors c ON c.id = i.contractor_id
      WHERE i.status = 'Closed' AND i.is_deleted = FALSE AND i.actual_cost IS NOT NULL
      GROUP BY c.name
      ORDER BY SUM(i.actual_cost) DESC`
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
async function fetchCostTrends(months = TREND_MONTHS_DEFAULT) {
  const { rows } = await query(
    `WITH bounds AS (
       SELECT date_trunc('month', CURRENT_DATE) AS last_start,
              date_trunc('month', CURRENT_DATE)
                - make_interval(months => $1::int - 1) AS first_start
     ),
     months AS (
       SELECT generate_series(b.first_start, b.last_start, INTERVAL '1 month') AS month_start
         FROM bounds b
     ),
     actual AS (
       SELECT date_trunc('month', i.closed_at) AS month_start,
              SUM(i.actual_cost) AS total
         FROM inspections i, bounds b
        WHERE i.status = 'Closed'
          AND i.is_deleted = FALSE
          AND i.actual_cost IS NOT NULL
          AND i.closed_at >= b.first_start
        GROUP BY 1
     ),
     projected AS (
       SELECT date_trunc('month', p.created_at) AS month_start,
              SUM(p.estimated_cost) AS total
         FROM ai_predictions p, bounds b
        WHERE p.status = 'Active'
          AND p.estimated_cost IS NOT NULL
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
    [months]
  );

  return rows.map((r) => ({
    month: r.month,
    actual: num(r.actual),
    projected: num(r.projected),
  }));
}

// { byCategory, byBlock, byContractor }
async function fetchCostBreakdown() {
  const byCategory = await fetchBreakdownBy('category', 'category');
  const byBlock = await fetchBreakdownBy('location_block', 'block');
  const byContractor = await fetchCostByContractor();
  return { byCategory, byBlock, byContractor };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// GET /api/admin/costs/summary
async function getCostSummary(req, res, next) {
  try {
    res.json(await fetchCostSummary());
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/costs/breakdown
async function getCostBreakdown(req, res, next) {
  try {
    res.json(await fetchCostBreakdown());
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/costs/trends?months=12 → { data: [{ month, actual, projected }] }
// `months` is optional. Rejecting a bad value rather than silently falling back
// keeps the chart honest: a typo'd ?months=6o should not quietly render a
// 12-month line the admin believes is 6 months.
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
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: `months must be an integer between ${TREND_MONTHS_MIN} and ${TREND_MONTHS_MAX}.`,
        });
      }
    }

    res.json({ data: await fetchCostTrends(months) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  TREND_MONTHS_DEFAULT,
  getCostSummary,
  getCostBreakdown,
  getCostTrends,
  fetchCostSummary,
  fetchCostBreakdown,
  fetchCostTrends,
};
