// DB queries for the inspections table (UC-001 resident complaints and
// inspector lift spot-checks).
'use strict';

const { pool, query } = require('../config/db');
const signatureModel = require('./signatureModel');
const cvDetectionModel = require('./cvDetectionModel');

// Insert a new inspection record. UC-001 uses source_type 'resident_complaint';
// the caller supplies the resident + report fields plus the AI-derived
// category/score. Everything else (status 'Open', priority 'Medium',
// photo_pending, is_deleted, timestamps) uses the schema defaults, and all
// inspector/lift/contractor/cost columns are left NULL. photo_url,
// location_unit and cv_detection_id are optional (pass undefined → NULL);
// cv_detection_id links back to a confirmed CV detection on the same photo.
// Returns the created row.
async function create(data) {
  const {
    source_type = 'resident_complaint',
    resident_id,
    title,
    description,
    location_block,
    location_unit,
    photo_url,
    category = 'Uncategorised',
    ai_priority_score,
    source_flag = 'Resident',
    cv_detection_id,
    gps_lat,
    gps_lng,
    gps_accuracy_m,
    gps_captured_at,
  } = data;

  const result = await query(
    `INSERT INTO inspections (
       source_type, resident_id, title, description, location_block,
       location_unit, photo_url, category, ai_priority_score, source_flag,
       cv_detection_id, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
      cv_detection_id,
      gps_lat,
      gps_lng,
      gps_accuracy_m,
      gps_captured_at,
    ]
  );
  return result.rows[0];
}

// Insert a lift inspection plus its checklist results atomically (one child row
// per checklist item; items may carry a per-defect photo_url). Caller supplies
// inspector/lift/title/block/contractor and the checklist array; category and
// resident columns stay at their defaults — no AI categorisation for lift
// inspections. `serviced_at` is the paper form's Servicing Date (the contractor
// visit being audited) and is optional. Rolls back on any failure. Returns the
// inspection row with a checklist_results array attached.
async function createLiftInspection(data) {
  const {
    inspector_id,
    lift_id,
    title,
    location_block,
    contractor_id,
    checklist,
    serviced_at,
    gps_lat,
    gps_lng,
    gps_accuracy_m,
    gps_captured_at,
  } = data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inspectionResult = await client.query(
      `INSERT INTO inspections (
         source_type, inspector_id, lift_id, title, location_block,
         contractor_id, source_flag, serviced_at, gps_lat, gps_lng,
         gps_accuracy_m, gps_captured_at
       )
       VALUES ('lift_inspection', $1, $2, $3, $4, $5, 'Inspector', $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        inspector_id, lift_id, title, location_block, contractor_id,
        serviced_at, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
      ]
    );
    const inspection = inspectionResult.rows[0];

    const checklist_results = [];
    for (const item of checklist) {
      const resultRow = await client.query(
        `INSERT INTO checklist_results (
           inspection_id, checklist_item_id, result, severity, remark, photo_url
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          inspection.id,
          item.checklist_item_id,
          item.result,
          item.severity,
          item.remark,
          item.photo_url,
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

// List all non-deleted inspections the user originated — resident complaints
// they filed or lift inspections they performed — newest first (HLD §6.2 /my).
async function findByOriginator(userId) {
  const result = await query(
    `SELECT * FROM inspections
     WHERE (resident_id = $1 OR inspector_id = $1) AND is_deleted = FALSE
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// Manager triage queue (UC-002): all non-deleted records, optionally filtered,
// most urgent first (highest AI priority score, then newest).
async function findAllForManager({ status, category, block } = {}) {
  const where = ['is_deleted = FALSE'];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (block) {
    params.push(block);
    where.push(`location_block = $${params.length}`);
  }

  const result = await query(
    `SELECT * FROM inspections
     WHERE ${where.join(' AND ')}
     ORDER BY ai_priority_score DESC NULLS LAST, created_at DESC`,
    params
  );
  return result.rows;
}

// Full detail for the manager view: the row plus its audit history (actor names
// joined from users) and, for a CV-linked record (UC-007), the underlying
// cv_detections row (bounding_box/defect_class/confidence) so the frontend can
// draw the overlay — null when this record has no cv_detection_id.
// Returns undefined when the id doesn't match a live record.
// Note: the reporter is identified by block/unit only — no resident-name join.
async function findDetailById(id) {
  const inspection = await findById(id);
  if (!inspection) return undefined;

  const history = await query(
    `SELECT h.action, h.previous_status, h.new_status, h.note, h.created_at,
            u.full_name AS actor_name
     FROM inspection_history h
     LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.inspection_id = $1
     ORDER BY h.created_at DESC`,
    [id]
  );

  const cv_detection = inspection.cv_detection_id
    ? await cvDetectionModel.findById(inspection.cv_detection_id)
    : null;

  return { ...inspection, history: history.rows, cv_detection };
}

// Manager triage update (UC-002): apply the provided changes and write an
// inspection_history audit row atomically. `changes` may contain priority,
// status, contractor_id, target_deadline, hold_reason — only provided keys are
// updated. Returns the updated row (with previous_status attached for the
// caller), or undefined when the id doesn't match a live record.
async function updateByManager(id, changes, actorId, note) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM inspections WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
      [id]
    );
    const before = existing.rows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return undefined;
    }

    // Build SET clauses for just the provided fields.
    const fields = ['priority', 'status', 'contractor_id', 'target_deadline', 'hold_reason'];
    const sets = [];
    const params = [];
    for (const field of fields) {
      if (changes[field] !== undefined) {
        params.push(changes[field]);
        sets.push(`${field} = $${params.length}`);
      }
    }
    sets.push('updated_at = NOW()');
    params.push(id);

    const updated = await client.query(
      `UPDATE inspections SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    const after = updated.rows[0];

    // Audit trail: who changed what, from which status to which.
    const action = changes.contractor_id !== undefined
      ? 'Assigned'
      : changes.status !== undefined
        ? 'Status Updated'
        : 'Priority Escalated';
    await client.query(
      `INSERT INTO inspection_history (
         inspection_id, actor_id, action, previous_status, new_status, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actorId, action, before.status, after.status, note]
    );

    await client.query('COMMIT');
    return { ...after, previous_status: before.status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Close a record (UC-004): set the closing fields + computed resolution time,
// archive it (is_deleted = TRUE for the 5-year audit trail), store the dual
// endorsement signatures, and write a 'Closed' audit row — all atomically.
// `signatures` is an array of { signer_role, signer_id, image_url }.
// Returns the updated row, or undefined if the id isn't a live record.
async function closeInspection(id, { closing_remark, actual_cost, signatures }, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM inspections WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
      [id]
    );
    const before = existing.rows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const updated = await client.query(
      `UPDATE inspections
         SET status = 'Closed',
             is_deleted = TRUE,
             closing_remark = $2,
             actual_cost = $3,
             closed_at = NOW(),
             resolution_time_hours = ROUND(
               EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0, 2
             ),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, closing_remark, actual_cost]
    );
    const after = updated.rows[0];

    // Dual endorsement signatures (manager + the second endorser).
    for (const sig of signatures) {
      await signatureModel.create({ inspection_id: id, ...sig }, client);
    }

    await client.query(
      `INSERT INTO inspection_history (
         inspection_id, actor_id, action, previous_status, new_status, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actorId, 'Closed', before.status, 'Closed', closing_remark]
    );

    await client.query('COMMIT');
    return after;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Recurrence trigger (UC-004 → UC-006): if closing this record makes 3 or more
// closed records for the same block + category within 30 days, queue an ai_jobs
// row so the nightly recommendation run prioritises this pair. Best-effort —
// callers wrap this so an analytics-queue hiccup never fails the close.
// Returns true when a job was queued.
async function queueRecurrenceJob(inspectionId, locationBlock, category) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM inspections
     WHERE status = 'Closed' AND location_block = $1 AND category = $2
       AND closed_at > NOW() - INTERVAL '30 days'`,
    [locationBlock, category]
  );
  if (rows[0].n >= 3) {
    await query(
      `INSERT INTO ai_jobs (location_block, category, triggered_by)
       VALUES ($1, $2, $3)`,
      [locationBlock, category, inspectionId]
    );
    return true;
  }
  return false;
}

// --- Contractor portal (UC-010) -------------------------------------------

// Defects assigned to one contractor for their inbox. Non-deleted records where
// contractor_id matches, soonest deadline first, each with a days_remaining
// countdown (NULL when no deadline set). The defect checklist_results (the
// Defect rows the contractor must rectify, with their template item text) are
// fetched in a second query and grouped in, so the frontend can render the
// per-item completion form without another round trip.
async function findAssignedToContractor(contractorId) {
  const inspections = await query(
    `SELECT *,
            (target_deadline::date - CURRENT_DATE) AS days_remaining
     FROM inspections
     WHERE contractor_id = $1 AND is_deleted = FALSE
     ORDER BY target_deadline ASC NULLS LAST, created_at DESC`,
    [contractorId]
  );
  if (inspections.rows.length === 0) return [];

  const ids = inspections.rows.map((r) => r.id);
  const results = await query(
    `SELECT cr.*, ci.item_text, ci.section
     FROM checklist_results cr
     JOIN checklist_items ci ON ci.id = cr.checklist_item_id
     WHERE cr.inspection_id = ANY($1) AND cr.result = 'Defect'
     ORDER BY ci.display_order`,
    [ids]
  );

  const byInspection = new Map(ids.map((id) => [id, []]));
  for (const row of results.rows) {
    byInspection.get(row.inspection_id).push(row);
  }
  return inspections.rows.map((ins) => ({
    ...ins,
    checklist_results: byInspection.get(ins.id),
  }));
}

// Shared helper: load an inspection FOR UPDATE only if it is live and assigned
// to this contractor (UC-010 E3 — a record reassigned away is no longer theirs).
// Returns the row, or undefined so the caller can 404.
async function lockAssigned(client, id, contractorId) {
  const { rows } = await client.query(
    `SELECT * FROM inspections
     WHERE id = $1 AND contractor_id = $2 AND is_deleted = FALSE
     FOR UPDATE`,
    [id, contractorId]
  );
  return rows[0];
}

// Contractor acknowledges a defect (UC-010 step 3): status → Acknowledged,
// stamp acknowledged_at, write an audit row. Returns the updated row, or
// undefined when the record isn't a live defect assigned to this contractor.
async function acknowledgeByContractor(id, contractorId, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await lockAssigned(client, id, contractorId);
    if (!before) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const updated = await client.query(
      `UPDATE inspections
       SET status = 'Acknowledged', acknowledged_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query(
      `INSERT INTO inspection_history
         (inspection_id, actor_id, action, previous_status, new_status)
       VALUES ($1, $2, 'Acknowledged', $3, 'Acknowledged')`,
      [id, actorId, before.status]
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Contractor records rectification work (UC-010 steps 5–7 + Alt Flow B partial).
// Writes each item's completion photo/remark and its `rectified` flag, then
// branches on `finalize`:
//   • finalize → status 'Rectified', stamp rectified_at, store the contractor
//     e-signature, audit 'Rectified & Signed' (the full completion).
//   • partial  → status 'Acknowledged' (only if it was 'Assigned'), audit
//     'Work Progress Saved', no signature. The record stays in the contractor's
//     inbox until every item is done and they finalize.
// `items` is an array of { checklist_result_id, completion_remark,
// completion_photo_url, rectified }. All atomic. Returns the updated row, or
// undefined when it isn't assigned to this contractor.
async function rectifyByContractor(
  id,
  contractorId,
  actorId,
  { items = [], signatureUrl, note, finalize = true }
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await lockAssigned(client, id, contractorId);
    if (!before) {
      await client.query('ROLLBACK');
      return undefined;
    }

    // Per-item completion. COALESCE keeps an earlier photo if none re-uploaded;
    // `rectified` defaults TRUE so an item present without the flag counts done.
    for (const item of items) {
      await client.query(
        `UPDATE checklist_results
         SET completion_photo_url = COALESCE($3, completion_photo_url),
             completion_remark = $4,
             rectified = $5
         WHERE id = $1 AND inspection_id = $2`,
        [
          item.checklist_result_id,
          id,
          item.completion_photo_url,
          item.completion_remark,
          item.rectified !== false,
        ]
      );
    }

    let updated;
    if (finalize) {
      updated = await client.query(
        `UPDATE inspections
         SET status = 'Rectified', rectified_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id]
      );
      await signatureModel.create(
        { inspection_id: id, signer_role: 'contractor', signer_id: actorId, image_url: signatureUrl },
        client
      );
      await client.query(
        `INSERT INTO inspection_history
           (inspection_id, actor_id, action, previous_status, new_status, note)
         VALUES ($1, $2, 'Rectified & Signed', $3, 'Rectified', $4)`,
        [id, actorId, before.status, note]
      );
    } else {
      // Partial save: nudge Assigned → Acknowledged (work in progress), keep any
      // other status (e.g. On Hold) as-is.
      const newStatus = before.status === 'Assigned' ? 'Acknowledged' : before.status;
      updated = await client.query(
        `UPDATE inspections
         SET status = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, newStatus]
      );
      await client.query(
        `INSERT INTO inspection_history
           (inspection_id, actor_id, action, previous_status, new_status, note)
         VALUES ($1, $2, 'Work Progress Saved', $3, $4, $5)`,
        [id, actorId, before.status, newStatus, note]
      );
    }

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Contractor puts a defect on hold (UC-010 Alt Flow A): status → On Hold with a
// reason; the deadline countdown pauses (the frontend hides it while held).
// Returns the updated row, or undefined when it isn't assigned to this contractor.
async function holdByContractor(id, contractorId, actorId, hold_reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await lockAssigned(client, id, contractorId);
    if (!before) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const updated = await client.query(
      `UPDATE inspections
       SET status = 'On Hold', hold_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, hold_reason]
    );
    await client.query(
      `INSERT INTO inspection_history
         (inspection_id, actor_id, action, previous_status, new_status, note)
       VALUES ($1, $2, 'On Hold', $3, 'On Hold', $4)`,
      [id, actorId, before.status, hold_reason]
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Privacy-safe estate-wide feed for the resident status board. The column list
// is a deliberate allow-list — NEVER add resident_id, location_unit, title,
// description, photo/audio URLs, GPS, or any identifying field here.
async function findForStatusBoard() {
  const result = await query(
    `SELECT id, location_block, category, status, created_at
     FROM inspections
     WHERE source_type = 'resident_complaint' AND is_deleted = FALSE
     ORDER BY created_at DESC`
  );
  return result.rows;
}

module.exports = {
  create,
  createLiftInspection,
  findById,
  closeInspection,
  findAllForManager,
  findAssignedToContractor,
  acknowledgeByContractor,
  rectifyByContractor,
  holdByContractor,
  findByOriginator,
  findByResident,
  findDetailById,
  findForStatusBoard,
  queueRecurrenceJob,
  updateByManager,
};
