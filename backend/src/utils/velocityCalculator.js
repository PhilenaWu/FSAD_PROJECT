// Failure/defect velocity foundation for UC-006 (AI Recommendation and
// Cost-Prediction Engine). Compares the most recent 30-day period against the
// preceding 30-day period for a given block + category so a later
// orchestration step can raise an amber alert on rising defect patterns.
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/**
 * Compute defect velocity for one (block, category) pair.
 *
 * Time windows (half-open, UTC, non-overlapping so a record on a boundary is
 * counted at most once):
 *   - current period: [asOf - 30 days, asOf)
 *   - prior   period: [asOf - 60 days, asOf - 30 days)
 *
 * Formula (UC-006):
 *   velocity_pct = ((count_last_30 - count_prior_30) / count_prior_30) * 100
 *
 * Zero-baseline policy (avoids Infinity / NaN):
 *   - count_prior_30 === 0 && count_last_30 >= 3  -> velocity_pct = 100
 *     (an emerging pattern; a finite value that clears the later >= 40 alert
 *     threshold without dividing by zero)
 *   - both counts zero                            -> velocity_pct = 0
 *
 * Eligibility:
 *   - count_last_30 < 3 -> is_eligible = false, reason = 'INSUFFICIENT_CURRENT_DATA',
 *     velocity_pct = 0. The value is forced to a safe 0 (below the 40 threshold)
 *     so an ineligible pair can never later produce an alert.
 *
 * @param {string} block - inspections.location_block (non-blank).
 * @param {string} category - inspections.category (non-blank).
 * @param {{ query: (sql: string, params: any[]) => Promise<{ rows: any[] }> }} db
 *   Database wrapper exposing an async pg-compatible query(sql, params).
 * @param {{ asOf?: Date }} [options] - optional; asOf defaults to now (for
 *   deterministic testing). Existing three-argument calls work unchanged.
 * @returns {Promise<{
 *   count_last_30: number,
 *   count_prior_30: number,
 *   velocity_pct: number,
 *   is_eligible: boolean,
 *   reason: string|null
 * }>} JSON-serialisable result; velocity_pct is always a finite JS number
 *   (never a PostgreSQL numeric string) rounded to two decimal places.
 * @throws {Error} on blank/non-string block or category, an invalid db.query
 *   dependency, or an invalid asOf date (all thrown before any query runs).
 * @throws {Error} if the underlying database query rejects (message wrapped
 *   without leaking SQL or credentials).
 */
async function calculateVelocity(block, category, db, options = {}) {
  // --- input validation (runs before any DB round trip) ---
  if (typeof block !== 'string' || block.trim() === '') {
    throw new Error('calculateVelocity: block must be a non-empty string');
  }
  if (typeof category !== 'string' || category.trim() === '') {
    throw new Error('calculateVelocity: category must be a non-empty string');
  }
  if (!db || typeof db.query !== 'function') {
    throw new Error('calculateVelocity: db must expose an async query(sql, params) method');
  }

  const { asOf = new Date() } = options;
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new Error('calculateVelocity: asOf must be a valid Date');
  }

  // --- half-open window boundaries (passed as params, never interpolated) ---
  const asOfMs = asOf.getTime();
  const currentStart = new Date(asOfMs - WINDOW_DAYS * DAY_MS).toISOString();
  const priorStart = new Date(asOfMs - 2 * WINDOW_DAYS * DAY_MS).toISOString();
  const asOfIso = asOf.toISOString();

  // Single aggregate round trip. block/category/dates are all bound params.
  // FILTER splits the two non-overlapping windows in one pass.
  //
  // Deliberately NOT filtered on is_deleted. That flag is written only by the
  // manual close (UC-004) and the G6 zero-defect auto-file, so it marks a record
  // as archived, not deleted, and is TRUE for every Closed record. Filtering it
  // dropped every rectified defect out of both windows, which is precisely the
  // history velocity exists to measure: a block+category whose defects were all
  // closed read as zero activity, so a recurring fault could never raise an
  // alert once it had been fixed even once.
  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4) AS count_last_30,
      COUNT(*) FILTER (WHERE created_at >= $5 AND created_at < $3) AS count_prior_30
    FROM inspections
    WHERE location_block = $1
      AND category = $2
  `;
  const params = [block, category, currentStart, asOfIso, priorStart];

  let result;
  try {
    result = await db.query(sql, params);
  } catch (err) {
    // Wrap without leaking SQL text or connection details.
    throw new Error(`calculateVelocity: database query failed: ${err.message}`);
  }

  const row = (result && result.rows && result.rows[0]) || {};

  // pg returns COUNT as a numeric string; coerce to finite JS numbers.
  const count_last_30 = Number(row.count_last_30) || 0;
  const count_prior_30 = Number(row.count_prior_30) || 0;

  // Not enough current data: mark ineligible and keep velocity safe (0, below
  // the later >= 40 threshold) so it can never generate an alert.
  if (count_last_30 < 3) {
    return {
      count_last_30,
      count_prior_30,
      velocity_pct: 0,
      is_eligible: false,
      reason: 'INSUFFICIENT_CURRENT_DATA',
    };
  }

  // Eligible from here. Resolve velocity, guarding the zero prior baseline.
  let velocity_pct;
  if (count_prior_30 === 0) {
    // count_last_30 >= 3 here: emerging pattern -> documented finite 100.
    velocity_pct = 100;
  } else {
    velocity_pct = ((count_last_30 - count_prior_30) / count_prior_30) * 100;
  }

  // Round to two decimals; Number() keeps the runtime type as a number.
  velocity_pct = Number(velocity_pct.toFixed(2));

  return {
    count_last_30,
    count_prior_30,
    velocity_pct,
    is_eligible: true,
    reason: null,
  };
}

module.exports = { calculateVelocity };
