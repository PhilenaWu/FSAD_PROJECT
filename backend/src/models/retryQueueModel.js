// DB queries for the retry_queue table (Roboflow rate-limit buffer, UC-007).
'use strict';

const { query } = require('../config/db');

// Queue an image that hit Roboflow's rate limit. inspection_id is optional —
// set when the image came from a specific resident/inspector submission, so
// a later successful retry can look up its location for the auto-ticket.
async function create({ image_url, inspection_id }) {
  const result = await query(
    `INSERT INTO retry_queue (image_url, inspection_id) VALUES ($1, $2) RETURNING *`,
    [image_url, inspection_id]
  );
  return result.rows[0];
}

// Pending rows whose backoff window has elapsed, oldest first — these are
// the rows a batch-scan run should actually retry now.
async function findPending() {
  const result = await query(
    `SELECT * FROM retry_queue WHERE status = 'pending' AND retry_after <= NOW() ORDER BY created_at`
  );
  return result.rows;
}

// All pending rows regardless of backoff window — the queue's total depth,
// for reporting (some may still be backing off and weren't retried this run).
async function countPending() {
  const result = await query(`SELECT COUNT(*)::int AS count FROM retry_queue WHERE status = 'pending'`);
  return result.rows[0].count;
}

async function markProcessed(id) {
  const result = await query(
    `UPDATE retry_queue SET status = 'processed' WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

async function markFailed(id) {
  const result = await query(
    `UPDATE retry_queue SET status = 'failed' WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

// Still rate-limited on retry: bump the attempt count and push the backoff
// window back 5 minutes (flat, not exponential — keep it simple).
async function reschedule(id) {
  const result = await query(
    `UPDATE retry_queue
     SET attempts = attempts + 1, retry_after = NOW() + INTERVAL '5 minutes'
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0];
}

module.exports = { create, findPending, countPending, markProcessed, markFailed, reschedule };
