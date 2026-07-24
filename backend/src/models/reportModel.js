// DB queries for UC-009 automated monthly reports. Raw parameterised SQL via
// the shared pg pool — no ORM. getReportData aggregates every metric the monthly
// PDF needs for a [startDate, endDate) window: counts by status / category /
// block, average rectification time, SLA compliance, top recurring defects, and
// cost totals. All inspection queries exclude soft-deleted rows (is_deleted).
'use strict';

const { query } = require('../config/db');

/**
 * @typedef {Object} CountRow
 * @property {string} [status]   - present on the by-status breakdown.
 * @property {string} [category] - present on category / recurring breakdowns.
 * @property {string} [block]    - present on block / recurring breakdowns.
 * @property {number} count      - number of defects in that bucket.
 */

/**
 * @typedef {Object} ReportData
 * @property {{ startDate: string, endDate: string }} period - the requested
 *   window (half-open: startDate inclusive, endDate exclusive).
 * @property {number} totalDefects - total non-deleted defects created in period.
 * @property {CountRow[]} byStatus - counts grouped by status, highest first.
 * @property {CountRow[]} byCategory - counts grouped by category, highest first.
 * @property {CountRow[]} byBlock - counts grouped by location_block, highest first.
 * @property {{ hours: number|null, days: number|null }} avgRectification -
 *   mean time from created_at to rectified_at over rectified defects (null when
 *   nothing was rectified in the period).
 * @property {{ compliant: number, eligible: number, compliancePct: number }} sla
 *   - SLA compliance: `compliant` met rectified_at <= target_deadline out of
 *   `eligible` (records with both a deadline and a rectified time); compliancePct
 *   is compliant/eligible as a percentage (0 when eligible is 0).
 * @property {CountRow[]} topRecurringDefects - up to 5 (category, block) combos
 *   that occurred more than once, highest first.
 * @property {{ actual: number, estimated: number, projected: number }} costs -
 *   actual = SUM(actual_cost) of closed defects in period; estimated =
 *   SUM(estimated_cost) of active AI predictions (open, projected); projected =
 *   actual + estimated.
 */

/**
 * Aggregate all metrics for the monthly estate report over a date window.
 *
 * Runs the breakdown, scalar-aggregate, recurring, and prediction queries in
 * parallel and assembles them into a single {@link ReportData} object. Soft-
 * deleted inspections are excluded everywhere. The window is half-open:
 * `created_at >= startDate AND created_at < endDate`.
 *
 * @param {string|Date} startDate - inclusive start of the window (ISO string or Date).
 * @param {string|Date} endDate - exclusive end of the window (ISO string or Date).
 * @returns {Promise<ReportData>} the assembled report metrics.
 * @throws {Error} if any underlying query fails (propagated from pg).
 */
async function getReportData(startDate, endDate) {
  const params = [startDate, endDate];
  // Shared period predicate for every inspections query.
  const inPeriod = 'is_deleted = FALSE AND created_at >= $1 AND created_at < $2';

  const [statusRes, categoryRes, blockRes, scalarRes, recurringRes, predictionRes] =
    await Promise.all([
      query(
        `SELECT status, COUNT(*)::int AS count
           FROM inspections
          WHERE ${inPeriod}
          GROUP BY status
          ORDER BY count DESC, status ASC`,
        params
      ),
      query(
        `SELECT category, COUNT(*)::int AS count
           FROM inspections
          WHERE ${inPeriod}
          GROUP BY category
          ORDER BY count DESC, category ASC`,
        params
      ),
      query(
        `SELECT location_block AS block, COUNT(*)::int AS count
           FROM inspections
          WHERE ${inPeriod}
          GROUP BY location_block
          ORDER BY count DESC, location_block ASC`,
        params
      ),
      // Scalar aggregates in one round trip. Average rectification time is
      // derived from timestamps (created_at -> rectified_at) in hours. SLA
      // compliance is judged only on records that have both a deadline and a
      // rectified time. Cost is the sum of actual_cost over closed records.
      query(
        `SELECT
           COUNT(*)::int AS total,
           ROUND(
             AVG(EXTRACT(EPOCH FROM (rectified_at - created_at)) / 3600.0)
               FILTER (WHERE rectified_at IS NOT NULL)::numeric,
             2
           )::float AS avg_rectification_hours,
           COUNT(*) FILTER (
             WHERE rectified_at IS NOT NULL
               AND target_deadline IS NOT NULL
               AND rectified_at <= target_deadline
           )::int AS sla_compliant,
           COUNT(*) FILTER (
             WHERE rectified_at IS NOT NULL
               AND target_deadline IS NOT NULL
           )::int AS sla_eligible,
           COALESCE(SUM(actual_cost) FILTER (WHERE status = 'Closed'), 0)::float
             AS actual_cost_total
         FROM inspections
         WHERE ${inPeriod}`,
        params
      ),
      query(
        `SELECT category, location_block AS block, COUNT(*)::int AS count
           FROM inspections
          WHERE ${inPeriod}
          GROUP BY category, location_block
         HAVING COUNT(*) > 1
          ORDER BY count DESC, category ASC
          LIMIT 5`,
        params
      ),
      // Open predictions: Active AI risk alerts carry the projected cost impact.
      query(
        `SELECT COALESCE(SUM(estimated_cost), 0)::float AS estimated_cost_total
           FROM ai_predictions
          WHERE status = 'Active'`
      ),
    ]);

  const s = scalarRes.rows[0];
  const eligible = s.sla_eligible;
  // Percentage with one decimal; 0 when there is nothing eligible to judge.
  const compliancePct =
    eligible > 0 ? Math.round((s.sla_compliant / eligible) * 1000) / 10 : 0;

  const hours = s.avg_rectification_hours; // null when nothing rectified
  const actual = s.actual_cost_total;
  const estimated = predictionRes.rows[0].estimated_cost_total;

  return {
    period: { startDate: String(startDate), endDate: String(endDate) },
    totalDefects: s.total,
    byStatus: statusRes.rows,
    byCategory: categoryRes.rows,
    byBlock: blockRes.rows,
    avgRectification: {
      hours,
      days: hours == null ? null : Math.round((hours / 24) * 10) / 10,
    },
    sla: { compliant: s.sla_compliant, eligible, compliancePct },
    topRecurringDefects: recurringRes.rows,
    costs: {
      actual,
      estimated,
      projected: Math.round((actual + estimated) * 100) / 100,
    },
  };
}

// Columns returned when reading back a reports row.
const REPORT_COLUMNS =
  'id, report_url, period_start, period_end, generated_at, ' +
  'triggered_by, report_status, email_delivered';

/**
 * Insert an audit row for a generated report.
 *
 * @param {Object} reportData
 * @param {string|null} reportData.report_url - Cloudinary URL, or null if upload failed.
 * @param {string|Date} reportData.period_start - inclusive start of the period.
 * @param {string|Date} reportData.period_end - exclusive end of the period.
 * @param {'github_actions'|'manual'} reportData.triggered_by - what triggered the run.
 * @param {'Ready'|'Upload failed'} [reportData.report_status='Ready'] - outcome.
 * @param {boolean} [reportData.email_delivered=false] - whether the email was sent.
 * @returns {Promise<Object>} the created reports row.
 * @throws {Error} if the insert fails (propagated from pg).
 */
async function createReport(reportData) {
  const {
    report_url,
    period_start,
    period_end,
    triggered_by,
    report_status = 'Ready',
    email_delivered = false,
  } = reportData;

  const { rows } = await query(
    `INSERT INTO reports
       (report_url, period_start, period_end, triggered_by, report_status, email_delivered)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${REPORT_COLUMNS}`,
    [report_url, period_start, period_end, triggered_by, report_status, email_delivered]
  );
  return rows[0];
}

/**
 * Flag whether a report's email was delivered (set after a successful send).
 *
 * @param {string} id - reports row id.
 * @param {boolean} delivered - new email_delivered value.
 * @returns {Promise<Object|undefined>} the updated row, or undefined if no match.
 * @throws {Error} if the update fails (propagated from pg).
 */
async function updateEmailDelivered(id, delivered) {
  const { rows } = await query(
    `UPDATE reports SET email_delivered = $2 WHERE id = $1
     RETURNING ${REPORT_COLUMNS}`,
    [id, delivered]
  );
  return rows[0];
}

/**
 * Email addresses of the active managers/admins who should receive the report.
 *
 * @returns {Promise<string[]>} recipient email addresses (may be empty).
 * @throws {Error} if the query fails (propagated from pg).
 */
async function getReportRecipients() {
  const { rows } = await query(
    `SELECT email FROM users
      WHERE role IN ('manager', 'admin') AND status = 'active'
      ORDER BY role`
  );
  return rows.map((r) => r.email);
}

module.exports = { getReportData, createReport, updateEmailDelivered, getReportRecipients };
