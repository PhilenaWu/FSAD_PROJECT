// DB queries for UC-003 "my reports" — the originator's own view of a record.
// Scoped to the caller throughout: a resident sees the complaints they filed and
// an inspector the spot-checks they performed, nothing else.
//
// Closed records are soft-deleted (is_deleted = TRUE) for the 5-year audit trail.
// They stay readable here — the originator's history — so a resident can still
// see how their report ended, and rate it if they never got the chance before it
// was closed. The active list (GET /api/inspections/my) excludes them.
'use strict';

const { query } = require('../config/db');

// One record the caller originated, live or archived, or undefined. The scoping
// predicate lives here so every read path shares it: a record that isn't the
// caller's is indistinguishable from one that doesn't exist.
async function findOwnRecord(id, userId) {
  const result = await query(
    `SELECT * FROM inspections
     WHERE id = $1 AND (resident_id = $2 OR inspector_id = $2)`,
    [id, userId]
  );
  return result.rows[0];
}

// The caller's closed records, most recently closed first.
async function findOwnArchived(userId) {
  const result = await query(
    `SELECT * FROM inspections
     WHERE (resident_id = $1 OR inspector_id = $1) AND is_deleted = TRUE
     ORDER BY closed_at DESC NULLS LAST, created_at DESC`,
    [userId]
  );
  return result.rows;
}

// Full detail for one of the caller's records: the row, its audit history
// (newest first, with actor names), and its checklist results.
//
// Note: checklist_items is joined without filtering on `active`. Retiring an item
// deactivates it rather than deleting it, so historical results must still
// resolve their section and text.
async function findOwnDetail(id, userId) {
  const inspection = await findOwnRecord(id, userId);
  if (!inspection) return undefined;

  const history = await query(
    `SELECT h.id, h.action, h.previous_status, h.new_status, h.note, h.created_at,
            u.full_name AS actor_name
     FROM inspection_history h
     LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.inspection_id = $1
     ORDER BY h.created_at DESC`,
    [id]
  );

  const checklist = await query(
    `SELECT r.id, r.result, r.severity, r.remark, r.photo_url,
            r.completion_photo_url, r.completion_remark, r.rectified,
            c.section, c.item_text, c.display_order
     FROM checklist_results r
     JOIN checklist_items c ON c.id = r.checklist_item_id
     WHERE r.inspection_id = $1
     ORDER BY c.section, c.display_order`,
    [id]
  );

  return {
    ...inspection,
    history: history.rows,
    checklist_results: checklist.rows,
  };
}

// Store a resident's satisfaction rating (UC-003 main flow 8-9). Scoped to the
// owning resident; the controller has already validated the value and checked
// both the status and that no rating exists yet. A rating is the resident's
// opinion of the outcome, not a state transition, so it is still accepted on an
// archived record — it changes no audited fact and no history row.
async function submitRating(id, residentId, { rating, comment }) {
  const result = await query(
    `UPDATE inspections
       SET satisfaction_rating = $3,
           satisfaction_comment = $4,
           updated_at = NOW()
     WHERE id = $1 AND resident_id = $2
     RETURNING *`,
    [id, residentId, rating, comment]
  );
  return result.rows[0];
}

// Edit a resident's own complaint (UC-003 extension): title, description,
// category, and location only — the photo stays as originally submitted (no
// re-upload handling, no question of re-running CV detection on a changed
// photo). Scoped to resident_id specifically, not the broader
// resident-or-inspector predicate findOwnRecord uses: an inspector's own
// spot-check has a structurally different shape (checklist, GPS, signature)
// and isn't editable through this path. The controller has already checked
// the 30-minute window and validated the fields before calling this.
async function updateOwnReport(id, residentId, {
  title, description, category, location_block, location_unit,
}) {
  const result = await query(
    `UPDATE inspections
       SET title = $3, description = $4, category = $5,
           location_block = $6, location_unit = $7, updated_at = NOW()
     WHERE id = $1 AND resident_id = $2
     RETURNING *`,
    [id, residentId, title, description, category, location_block, location_unit]
  );
  return result.rows[0];
}

module.exports = {
  findOwnArchived, findOwnDetail, findOwnRecord, submitRating, updateOwnReport,
};
