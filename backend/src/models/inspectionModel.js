// DB queries for the inspections table (UC-001 resident complaints and
// inspector lift spot-checks).
'use strict';

const { pool, query } = require('../config/db');

// Insert a new inspection record. UC-001 uses source_type 'resident_complaint';
// the caller supplies the resident + report fields plus the AI-derived
// category/score. Everything else (status 'Open', priority 'Medium',
// photo_pending, is_deleted, timestamps) uses the schema defaults, and all
// inspector/lift/contractor/cost columns are left NULL. photo_url and
// location_unit are optional (pass undefined → NULL). Returns the created row.
async function create(data) {
  const {
    source_type = 'resident_complaint',
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
    `INSERT INTO inspections (
       source_type, resident_id, title, description, location_block,
       location_unit, photo_url, category, ai_priority_score, source_flag
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      source_type,
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

// Insert a lift inspection plus its checklist results atomically (one child row
// per checklist item). Caller supplies inspector/lift/title/block/contractor and
// the checklist array; category/photo/resident columns stay at their defaults —
// no AI categorisation for lift inspections. Rolls back on any failure.
// Returns the inspection row with a checklist_results array attached.
async function createLiftInspection(data) {
  const {
    inspector_id,
    lift_id,
    title,
    location_block,
    contractor_id,
    checklist,
  } = data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inspectionResult = await client.query(
      `INSERT INTO inspections (
         source_type, inspector_id, lift_id, title, location_block,
         contractor_id, source_flag
       )
       VALUES ('lift_inspection', $1, $2, $3, $4, $5, 'Inspector')
       RETURNING *`,
      [inspector_id, lift_id, title, location_block, contractor_id]
    );
    const inspection = inspectionResult.rows[0];

    const checklist_results = [];
    for (const item of checklist) {
      const resultRow = await client.query(
        `INSERT INTO checklist_results (
           inspection_id, checklist_item_id, result, severity, remark
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          inspection.id,
          item.checklist_item_id,
          item.result,
          item.severity,
          item.remark,
        ]
      );
      checklist_results.push(resultRow.rows[0]);
    }

    await client.query('COMMIT');
    return { ...inspection, checklist_results };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Find one non-deleted inspection by id. Returns the row, or undefined if none.
async function findById(id) {
  const result = await query(
    'SELECT * FROM inspections WHERE id = $1 AND is_deleted = FALSE',
    [id]
  );
  return result.rows[0];
}

// List a resident's non-deleted inspections, newest first.
async function findByResident(residentId) {
  const result = await query(
    `SELECT * FROM inspections
     WHERE resident_id = $1 AND is_deleted = FALSE
     ORDER BY created_at DESC`,
    [residentId]
  );
  return result.rows;
}

module.exports = { create, createLiftInspection, findById, findByResident };
