// UC-005 analytics — heatmap, trends, SLA compliance, contractor scorecard,
// priority queue. All manager-only, raw SQL on `inspections`.
// Every endpoint accepts the same optional query params: ?from&to&block&category.
// The data queries live in exported fetch*() functions so the PowerPoint
// export (exportController) can build a deck from the same numbers.
'use strict';

const { query } = require('../config/db');

// SLA target for resolution, in hours (HLD §6.3 sample response).
const SLA_THRESHOLD_HRS = 72;

// Build a WHERE clause + params array from the shared filter query params.
// Returns { where: 'WHERE ...', params: [...] } — where is '' when unfiltered.
function buildFilters({ from, to, block, category, section }, columnPrefix = '') {
  const clauses = [];
  const params = [];
  const col = (name) => `${columnPrefix}${name}`;
  // Unprefixed callers select `FROM inspections`, prefixed ones `FROM inspections i`.
  const idCol = columnPrefix ? `${columnPrefix}id` : 'inspections.id';

  if (from) {
    params.push(from);
    clauses.push(`${col('created_at')} >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    // Inclusive end date: records created any time on the `to` day count.
    clauses.push(`${col('created_at')} < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (block) {
    params.push(block);
    clauses.push(`${col('location_block')} = $${params.length}`);
  }
  if (category) {
    params.push(category);
    clauses.push(`${col('category')} = $${params.length}`);
  }
  if (section) {
    params.push(section);
    // "Has at least one DEFECT in this section of the paper spot-check form"
    // (HLD §7.2 — Motor Room / Lift Car / Hoistway & Lift Pit). Matching on
    // Pass rows too would select nearly every inspection and say nothing.
    // Section names are read from checklist_items, never hardcoded, so the
    // re-seed to the real 25 paper items needs no change here.
    clauses.push(
      `EXISTS (
         SELECT 1 FROM checklist_results cr
         JOIN checklist_items ci ON ci.id = cr.checklist_item_id
         WHERE cr.inspection_id = ${idCol}
           AND cr.result = 'Defect'
           AND ci.section = $${params.length}
       )`
    );
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

// `inspections.reopen_count` arrives with the paper-form migration (026). The
// scorecard reports average re-opens once it exists and NULL before then, so
// this file works either side of that migration without a code change.
// Cached after the first lookup — the schema cannot change mid-process.
let reopenColumnPresent = null;
async function hasReopenCount() {
  if (reopenColumnPresent === null) {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inspections' AND column_name = 'reopen_count'`
    );
    reopenColumnPresent = rows.length > 0;
  }
  return reopenColumnPresent;
}

// ---------------------------------------------------------------------------
// Data fetchers — shared by the route handlers below and the pptx export.
// ---------------------------------------------------------------------------

// KPI summary with movement: current values plus % change vs the prior
// 30-day window (created in the last 30 days vs the 30 before that).
// Respects the block/category filters; the date filters are ignored here
// because the deltas define their own two windows.
async function fetchSummary({ block, category } = {}) {
  const { where, params } = buildFilters({ block, category });
  const and = where ? `${where} AND` : 'WHERE';

  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE is_deleted = FALSE
                          AND status NOT IN ('Resolved','Closed'))::int AS open_count,
       -- 'On Hold' is excluded: holding pauses the rectification clock (HLD
       -- G11), and the overdue-chase job skips held records too — counting
       -- them here would make the dashboard contradict the chase emails.
       -- is_deleted excluded to match open_count above.
       COUNT(*) FILTER (WHERE target_deadline < NOW()
                          AND is_deleted = FALSE
                          AND status NOT IN ('On Hold','Rectified','Resolved','Closed'))::int
         AS overdue_count,
       ROUND(AVG(resolution_time_hours) FILTER (WHERE closed_at IS NOT NULL)::numeric, 1)::float
         AS avg_resolution_hours,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_last_30,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 days'
                          AND created_at <  NOW() - INTERVAL '30 days')::int AS new_prior_30
     FROM inspections
     ${where}`,
    params
  );

  const sla = await query(
    `SELECT
       COUNT(*) FILTER (WHERE resolution_time_hours <= ${SLA_THRESHOLD_HRS})::int AS compliant,
       COUNT(*)::int AS total
     FROM inspections
     ${and} closed_at IS NOT NULL AND resolution_time_hours IS NOT NULL`,
    params
  );

  const s = rows[0];
  const { compliant, total } = sla.rows[0];
  const pctChange =
    s.new_prior_30 > 0
      ? Number((((s.new_last_30 - s.new_prior_30) / s.new_prior_30) * 100).toFixed(1))
      : null; // no prior-period data — the UI shows "no prior data" instead of a fake %

  return {
    open_count: s.open_count,
    overdue_count: s.overdue_count,
    avg_resolution_hours: s.avg_resolution_hours,
    sla_percentage: total ? Number(((compliant / total) * 100).toFixed(2)) : 0,
    new_last_30: s.new_last_30,
    new_prior_30: s.new_prior_30,
    new_records_change_pct: pctChange,
    sla_threshold_hrs: SLA_THRESHOLD_HRS,
  };
}

// Distinct blocks and categories that actually have records — drives the
// filter dropdowns so they never go stale as new data arrives (nothing
// hardcoded in the frontend).
async function fetchFilterOptions() {
  const blocks = await query(
    `SELECT DISTINCT location_block AS v FROM inspections ORDER BY location_block`
  );
  const categories = await query(
    `SELECT DISTINCT category AS v FROM inspections ORDER BY category`
  );
  // Paper-form sections come from the checklist template itself, so the
  // dropdown follows the seeded items (currently placeholders, later the
  // real A/B/C sections) with no frontend change.
  const sections = await query(
    `SELECT DISTINCT section AS v FROM checklist_items WHERE active = TRUE ORDER BY section`
  );
  return {
    blocks: blocks.rows.map((r) => r.v),
    categories: categories.rows.map((r) => r.v),
    sections: sections.rows.map((r) => r.v),
  };
}

// [{ block, category, count }]
async function fetchHeatmap(filters) {
  const { where, params } = buildFilters(filters);
  const { rows } = await query(
    `SELECT location_block AS block, category, COUNT(*)::int AS count
     FROM inspections
     ${where}
     GROUP BY location_block, category
     ORDER BY location_block, category`,
    params
  );
  return rows;
}

// [{ date, count }] — daily counts
async function fetchTrends(filters) {
  const { where, params } = buildFilters(filters);
  const { rows } = await query(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
     FROM inspections
     ${where}
     GROUP BY created_at::date
     ORDER BY created_at::date`,
    params
  );
  return rows;
}

// { compliant_count, total_resolved, sla_percentage, sla_threshold_hrs }
async function fetchSlaCompliance(filters) {
  const { where, params } = buildFilters(filters);
  // Only closed records have resolution_time_hours; measure those.
  const closedClause = 'closed_at IS NOT NULL AND resolution_time_hours IS NOT NULL';
  const fullWhere = where ? `${where} AND ${closedClause}` : `WHERE ${closedClause}`;

  params.push(SLA_THRESHOLD_HRS);
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE resolution_time_hours <= $${params.length})::int AS compliant_count,
       COUNT(*)::int AS total_resolved
     FROM inspections
     ${fullWhere}`,
    params
  );

  const { compliant_count, total_resolved } = rows[0];
  return {
    compliant_count,
    total_resolved,
    sla_percentage: total_resolved
      ? Number(((compliant_count / total_resolved) * 100).toFixed(2))
      : 0,
    sla_threshold_hrs: SLA_THRESHOLD_HRS,
  };
}

// Per contractor: jobs, avg rectification days (acknowledged → rectified),
// repeat-defect rate (share of jobs on a block+category the contractor has
// seen before), overdue count (past deadline and not yet rectified/closed),
// and average re-opens (UC-004 rejections sent back for rework).
async function fetchContractorScorecard(filters) {
  const { where, params } = buildFilters(filters, 'i.');
  const assignedClause = 'i.contractor_id IS NOT NULL';
  const fullWhere = where ? `${where} AND ${assignedClause}` : `WHERE ${assignedClause}`;

  // NULL until migration 026 adds the column; the table renders "—" for it.
  const avgReopens = (await hasReopenCount())
    ? 'ROUND(AVG(i.reopen_count)::numeric, 2)::float'
    : 'NULL::float';

  const { rows } = await query(
    `SELECT
       c.name AS contractor,
       COUNT(*)::int AS jobs,
       ROUND(AVG(
         EXTRACT(EPOCH FROM (i.rectified_at - i.acknowledged_at)) / 86400.0
       )::numeric, 1)::float AS avg_rectification_days,
       -- jobs beyond the first on the same block+category = repeats
       ROUND(
         100.0 * (COUNT(*) - COUNT(DISTINCT (i.location_block, i.category))) / COUNT(*),
         1
       )::float AS repeat_defect_rate,
       -- 'On Hold' excluded — see fetchSummary: a hold pauses the clock (G11),
       -- so a contractor waiting on site access or a part is not "overdue".
       COUNT(*) FILTER (
         WHERE i.target_deadline < NOW()
           AND i.status NOT IN ('On Hold', 'Rectified', 'Resolved', 'Closed')
       )::int AS overdue_count,
       ${avgReopens} AS avg_reopens
     FROM inspections i
     JOIN contractors c ON c.id = i.contractor_id
     ${fullWhere}
     GROUP BY c.name
     ORDER BY overdue_count DESC, avg_rectification_days DESC NULLS LAST`,
    params
  );
  return rows;
}

// Composite score (phase task 5.3):
//   (ai_priority_score × 0.5) + (recency_score × 0.3) + (frequency_score × 0.2)
// recency_score: newer = higher (100 at 0 days old, −10/day, floor 0).
// frequency_score: 10 points per open record sharing block+category, cap 100.
// Also accepts ?priority=Critical&status=Open on top of the shared filters.
async function fetchPriorityQueue(filters) {
  const { where, params } = buildFilters(filters, 'i.');
  const extra = [];
  if (filters.priority) {
    params.push(filters.priority);
    extra.push(`i.priority = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    extra.push(`i.status = $${params.length}`);
  }
  const openClause = [
    "i.is_deleted = FALSE AND i.status NOT IN ('Resolved', 'Closed')",
    ...extra,
  ].join(' AND ');
  const fullWhere = where ? `${where} AND ${openClause}` : `WHERE ${openClause}`;

  const { rows } = await query(
    `SELECT
       i.id,
       i.title,
       i.location_block AS block,
       i.category,
       i.priority,
       i.status,
       i.ai_priority_score,
       i.created_at,
       ROUND((
         COALESCE(i.ai_priority_score, 50) * 0.5
         + GREATEST(0, 100 - EXTRACT(DAY FROM NOW() - i.created_at) * 10) * 0.3
         + LEAST(100, freq.same_pair_count * 10) * 0.2
       )::numeric, 1)::float AS composite_score
     FROM inspections i
     JOIN LATERAL (
       -- OPEN records only. Counting resolved history here would rank a block
       -- that used to have problems as urgently as one that has them now —
       -- the queue answers "what needs attention today". Long-run recurrence
       -- is UC-006's job (velocity analysis), not this score's.
       SELECT COUNT(*)::int AS same_pair_count
       FROM inspections f
       WHERE f.location_block = i.location_block
         AND f.category = i.category
         AND f.is_deleted = FALSE
         AND f.status NOT IN ('Resolved', 'Closed')
     ) freq ON TRUE
     ${fullWhere}
     ORDER BY composite_score DESC`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Route handlers (HLD §6.3 response shapes).
// ---------------------------------------------------------------------------

// GET /api/analytics/filter-options → { blocks, categories, sections }
async function getFilterOptions(req, res, next) {
  try {
    res.json(await fetchFilterOptions());
  } catch (err) {
    next(err);
  }
}

// GET /api/analytics/summary → KPI tiles with vs-prior-period movement
async function getSummary(req, res, next) {
  try {
    res.json(await fetchSummary(req.query));
  } catch (err) {
    next(err);
  }
}

// GET /api/analytics/issues-by-block → { data: [...] }
async function getHeatmap(req, res, next) {
  try {
    res.json({ data: await fetchHeatmap(req.query) });
  } catch (err) {
    next(err);
  }
}

// GET /api/analytics/trends → { data: [...] }
async function getTrends(req, res, next) {
  try {
    res.json({ data: await fetchTrends(req.query) });
  } catch (err) {
    next(err);
  }
}

// GET /api/analytics/sla-compliance → { compliant_count, ... }
async function getSlaCompliance(req, res, next) {
  try {
    res.json(await fetchSlaCompliance(req.query));
  } catch (err) {
    next(err);
  }
}

// GET /api/analytics/contractor-scorecard → { data: [...] }
async function getContractorScorecard(req, res, next) {
  try {
    res.json({ data: await fetchContractorScorecard(req.query) });
  } catch (err) {
    next(err);
  }
}

// GET /api/analytics/priority-queue → { data: [...] }
async function getPriorityQueue(req, res, next) {
  try {
    res.json({ data: await fetchPriorityQueue(req.query) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  SLA_THRESHOLD_HRS,
  getFilterOptions,
  getSummary,
  getHeatmap,
  getTrends,
  getSlaCompliance,
  getContractorScorecard,
  getPriorityQueue,
  fetchFilterOptions,
  fetchSummary,
  fetchHeatmap,
  fetchTrends,
  fetchSlaCompliance,
  fetchContractorScorecard,
  fetchPriorityQueue,
};
