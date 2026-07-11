// DB queries for the lifts table (inspector lift spot-check, UC-001).
'use strict';

const { query } = require('../config/db');

// List all lifts with their responsible contractor's name, for the inspector's
// lift picker. Ordered for a stable dropdown.
async function findAll() {
  const result = await query(
    `SELECT l.*, c.name AS contractor_name
     FROM lifts l
     LEFT JOIN contractors c ON c.id = l.contractor_id
     ORDER BY l.block_number, l.lift_code`
  );
  return result.rows;
}

// Find one lift by id (same contractor join, so callers can derive the
// contractor assignment). Returns the row, or undefined if none.
async function findById(id) {
  const result = await query(
    `SELECT l.*, c.name AS contractor_name
     FROM lifts l
     LEFT JOIN contractors c ON c.id = l.contractor_id
     WHERE l.id = $1`,
    [id]
  );
  return result.rows[0];
}

module.exports = { findAll, findById };
