// DB queries for incidents table
'use strict';

const { query } = require('../config/db');

// Insert a new incident. Caller supplies the resident + report fields plus the
// AI-derived category/score; everything else (status 'Open', priority 'Medium',
// photo_pending, is_deleted, timestamps) uses the schema defaults. photo_url and
// location_unit are optional (pass undefined → NULL). Returns the created row.
async function create(data) {
  const {
    resident_id,
    title,
    description,
    location_block,
    location_unit,
    photo_url,
    category,
    ai_priority_score,
    source_flag = 'Resident',
  } = data;

  const result = await query(
    `INSERT INTO incidents (
       resident_id, title, description, location_block, location_unit,
       photo_url, category, ai_priority_score, source_flag
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      resident_id,
      title,
      description,
      location_block,
      location_unit,
      photo_url,
      category,
      ai_priority_score,
      source_flag,
    ]
  );
  return result.rows[0];
}

// Find one non-deleted incident by id. Returns the row, or undefined if none.
async function findById(id) {
  const result = await query(
    'SELECT * FROM incidents WHERE id = $1 AND is_deleted = FALSE',
    [id]
  );
  return result.rows[0];
}

// List a resident's non-deleted incidents, newest first.
async function findByResident(residentId) {
  const result = await query(
    `SELECT * FROM incidents
     WHERE resident_id = $1 AND is_deleted = FALSE
     ORDER BY created_at DESC`,
    [residentId]
  );
  return result.rows;
}

module.exports = { create, findById, findByResident };
