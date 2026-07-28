// DB queries for the cv_detections table (Roboflow defect detection results).
'use strict';

const { query } = require('../config/db');

// Insert a new detection result. bounding_box is a JS object (x, y, width,
// height) or null when detectDefect() found nothing; it's stringified for the
// jsonb column since node-postgres doesn't serialise plain objects itself.
// status defaults to 'pending' per the schema; callers set it explicitly once
// they know whether the confidence cleared the threshold. location_block/unit
// are optional (pass undefined → NULL) — captured so a low-confidence
// detection can still be turned into a ticket later with the right location.
async function create(data) {
  const {
    image_url, defect_class, confidence, bounding_box, source, status,
    location_block, location_unit,
  } = data;

  const result = await query(
    `INSERT INTO cv_detections (
       image_url, defect_class, confidence, bounding_box, source, status,
       location_block, location_unit
     )
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'pending'), $7, $8)
     RETURNING *`,
    [
      image_url,
      defect_class,
      confidence,
      bounding_box ? JSON.stringify(bounding_box) : null,
      source,
      status,
      location_block,
      location_unit,
    ]
  );
  return result.rows[0];
}

// Find one detection by id. Returns the row, or undefined if none.
async function findById(id) {
  const result = await query('SELECT * FROM cv_detections WHERE id = $1', [id]);
  return result.rows[0];
}

// List detections by status, newest first — used for the manager's manual
// review queue (status = 'low_confidence').
async function findByStatus(status) {
  const result = await query(
    'SELECT * FROM cv_detections WHERE status = $1 ORDER BY detected_at DESC',
    [status]
  );
  return result.rows;
}

// Set a detection's status (e.g. 'processed' once a manager turns it into a
// ticket, or 'dismissed' if they decide it's not a real defect). Returns the
// updated row, or undefined if the id doesn't match.
async function updateStatus(id, status) {
  const result = await query(
    'UPDATE cv_detections SET status = $2 WHERE id = $1 RETURNING *',
    [id, status]
  );
  return result.rows[0];
}

module.exports = { create, findById, findByStatus, updateStatus };
