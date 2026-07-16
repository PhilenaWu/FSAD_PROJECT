// DB queries for the cv_detections table (Roboflow defect detection results).
'use strict';

const { query } = require('../config/db');

// Insert a new detection result. bounding_box is a JS object (x, y, width,
// height) or null when detectDefect() found nothing; it's stringified for the
// jsonb column since node-postgres doesn't serialise plain objects itself.
// status defaults to 'pending' per the schema; callers set it explicitly once
// they know whether the confidence cleared the threshold.
async function create(data) {
  const { image_url, defect_class, confidence, bounding_box, source, status } = data;

  const result = await query(
    `INSERT INTO cv_detections (image_url, defect_class, confidence, bounding_box, source, status)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'pending'))
     RETURNING *`,
    [
      image_url,
      defect_class,
      confidence,
      bounding_box ? JSON.stringify(bounding_box) : null,
      source,
      status,
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

module.exports = { create, findById, findByStatus };
