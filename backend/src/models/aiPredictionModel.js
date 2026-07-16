// DB queries for the ai_predictions table (UC-006 AI risk alerts). Raw
// parameterised SQL via the shared pg pool — no ORM. velocity_pct and
// estimated_cost are returned as JS numbers (::float) so the dashboard's
// AIAlertCard can call .toFixed()/.toLocaleString() on them.
'use strict';

const { query } = require('../config/db');

/**
 * Insert a new AI risk prediction. status defaults to 'Active' at the DB level;
 * estimated_cost is nullable (null when there is no cost history to project).
 *
 * @param {Object} data
 * @param {string} data.location_block - block the alert is about.
 * @param {string} data.category - defect category the alert is about.
 * @param {number} data.velocity_pct - rise vs the prior 30 days (already rounded).
 * @param {number|null} [data.estimated_cost] - projected cost impact, or null.
 * @param {string} data.alert_text - plain-language alert shown on the card.
 * @returns {Promise<Object>} the created row (velocity_pct/estimated_cost as numbers).
 * @throws {Error} if the insert fails (propagated from pg).
 */
async function insert(data) {
  const {
    location_block,
    category,
    velocity_pct,
    estimated_cost = null,
    alert_text,
  } = data;

  const { rows } = await query(
    `INSERT INTO ai_predictions
       (location_block, category, velocity_pct, estimated_cost, alert_text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, location_block, category, velocity_pct::float,
               estimated_cost::float, alert_text, status, created_at`,
    [location_block, category, velocity_pct, estimated_cost, alert_text]
  );
  return rows[0];
}

/**
 * Update a prediction's status. When moving to 'Dismissed' the caller's id and
 * the dismissal time are stamped; for other statuses those columns are left
 * unchanged. Uses COALESCE so a non-dismiss update never nulls an existing stamp.
 *
 * @param {string} id - ai_predictions id.
 * @param {'Active'|'Accepted'|'Dismissed'} status - new status.
 * @param {string|null} [managerId] - manager performing a dismissal (stored in
 *   dismissed_by); ignored for non-dismiss transitions.
 * @returns {Promise<Object|undefined>} the updated row, or undefined if no row
 *   matched the id.
 * @throws {Error} if the update fails (propagated from pg).
 */
async function updateStatus(id, status, managerId = null) {
  const isDismiss = status === 'Dismissed';
  const { rows } = await query(
    `UPDATE ai_predictions
        SET status = $2,
            dismissed_by = CASE WHEN $3::boolean THEN $4 ELSE dismissed_by END,
            dismissed_at = CASE WHEN $3::boolean THEN NOW() ELSE dismissed_at END
      WHERE id = $1
      RETURNING id, location_block, category, velocity_pct::float,
                estimated_cost::float, alert_text, status, dismissed_by,
                dismissed_at, created_at`,
    [id, status, isDismiss, managerId]
  );
  return rows[0];
}

/**
 * List predictions, newest first, optionally filtered by status.
 *
 * @param {'Active'|'Accepted'|'Dismissed'|'all'} [status='Active'] - filter, or
 *   'all' for every status.
 * @returns {Promise<Object[]>} matching rows (velocity_pct/estimated_cost as numbers).
 * @throws {Error} if the query fails (propagated from pg).
 */
async function list(status = 'Active') {
  const params = [];
  let where = '';
  if (status !== 'all') {
    params.push(status);
    where = 'WHERE status = $1';
  }
  const { rows } = await query(
    `SELECT id, location_block, category, velocity_pct::float,
            estimated_cost::float, alert_text, status, created_at
       FROM ai_predictions
       ${where}
       ORDER BY created_at DESC`,
    params
  );
  return rows;
}

module.exports = { insert, updateStatus, list };
