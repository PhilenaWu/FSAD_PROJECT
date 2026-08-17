// DB queries for the inspections table (UC-001 resident complaints and
// inspector lift spot-checks).
'use strict';

const { pool, query } = require('../config/db');
const signatureModel = require('./signatureModel');
const cvDetectionModel = require('./cvDetectionModel');
const { onHoldSql } = require('../utils/onHold');

// Insert a new inspection record. UC-001 uses source_type 'resident_complaint';
// the caller supplies the resident + report fields plus the AI-derived
// category/score. Everything else (status 'Open', photo_pending, is_deleted,
// timestamps) uses the schema defaults, and all inspector/lift/contractor/cost
// columns are left NULL. photo_url, location_unit and cv_detection_id are
// optional (pass undefined → NULL); cv_detection_id links back to a confirmed
// CV detection on the same photo. category/priority default to the schema's
// own defaults in JS (not just SQL) because both columns are explicitly
// listed in the INSERT below — an omitted value would otherwise bind as an
// explicit NULL and violate the NOT NULL constraint instead of falling back
// to the column's DEFAULT. Returns the created row.
async function create(data) {
  const {
    source_type = 'resident_complaint',
    resident_id,
    title,
    description,
    location_block,
    location_unit,
    photo_url,
    category = 'Miscellaneous',
    priority = 'Medium',
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
       location_unit, photo_url, category, priority, ai_priority_score,
       source_flag, cv_detection_id, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
      priority,
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

// System-driven priority update (UC-007 CV/human-complaint blend). Also links
// cv_detection_id (when supplied) so the frontend's BoundingBoxOverlay has
// something to fetch — without this, a blended report has no way to surface
// the detection that influenced its priority. No inspection_history row is
// written — history.actor_id is NOT NULL and this isn't a manager action, so
// there's no valid actor to attribute it to (same reasoning as cv_auto_detected
// ticket creation, which also skips history).
// Returns the updated row, or undefined if the id doesn't match a live record.
async function updatePriority(id, { priority, ai_priority_score, cv_detection_id }) {
  const result = await query(
    `UPDATE inspections SET priority = $2, ai_priority_score = $3,
       cv_detection_id = COALESCE($4, cv_detection_id), updated_at = NOW()
     WHERE id = $1 AND is_deleted = FALSE
     RETURNING *`,
    [id, priority, ai_priority_score, cv_detection_id]
  );
  return result.rows[0];
}

// Insert a lift inspection plus its checklist results atomically (one child row
// per checklist item; items may carry a per-defect photo_url). Caller supplies
// inspector/lift/title/block/contractor and the checklist array; category and
// resident columns stay at their defaults — no AI categorisation for lift
// inspections. `serviced_at` is the paper form's Servicing Date (the contractor
// visit being audited) and is optional. `signature_url` is the inspector's
// "Checked by" e-signature (G5) — stored as a signatures row in the same
// transaction, alongside the UC-015 `Created` audit row, so a spot-check is
// never persisted without its attestation. Rolls back on any failure. Returns
// the inspection row with a checklist_results array attached.
async function createLiftInspection(data) {
  const {
    inspector_id,
    lift_id,
    title,
    location_block,
    contractor_id,
    checklist,
    serviced_at,
    signature_url,
    has_defects,
    gps_lat,
    gps_lng,
    gps_accuracy_m,
    gps_captured_at,
  } = data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // UC-001 step 11 Branch A: a spot-check that found defects lands in the
    // manager's queue as 'Pending Assignment', not the table's generic 'Open'
    // default — the defects are known, they just have no contractor committed
    // to them yet. The zero-defect branch below moves straight to 'Closed', so
    // this status is only ever the resting state for a defect-bearing check.
    const inspectionResult = await client.query(
      `INSERT INTO inspections (
         source_type, inspector_id, lift_id, title, location_block,
         contractor_id, source_flag, status, serviced_at, gps_lat, gps_lng,
         gps_accuracy_m, gps_captured_at
       )
       VALUES ('lift_inspection', $1, $2, $3, $4, $5, 'Inspector', $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        inspector_id, lift_id, title, location_block, contractor_id,
        has_defects ? 'Pending Assignment' : 'Open',
        serviced_at, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
      ]
    );
    let inspection = inspectionResult.rows[0];

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

    // G5: the inspector's "Checked by" signature from the paper form.
    await signatureModel.create(
      {
        inspection_id: inspection.id,
        signer_role: 'inspector',
        signer_id: inspector_id,
        image_url: signature_url,
      },
      client
    );

    // UC-015: the audit trail starts at creation, not at first triage.
    await client.query(
      `INSERT INTO inspection_history (
         inspection_id, actor_id, action, previous_status, new_status, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        inspection.id,
        inspector_id,
        'Created',
        null,
        inspection.status,
        `Spot-check filed for ${title}`,
      ]
    );

    // G6: a clean spot-check needs no contractor action, so it files straight
    // to Closed rather than sitting in the triage queue. is_deleted = TRUE
    // matches the manual close — the codebase's invariant is that a Closed
    // record is an archived one (the manager queue and status board both rely
    // on it). target_deadline is cleared because nothing is due for
    // rectification; resolution_time_hours stays NULL because it measures
    // defect turnaround, and there was no defect.
    if (!has_defects) {
      const filed = await client.query(
        `UPDATE inspections
            SET status = 'Closed',
                is_deleted = TRUE,
                closed_at = NOW(),
                target_deadline = NULL,
                closing_remark = 'Filed automatically — no defects found.',
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [inspection.id]
      );
      inspection = filed.rows[0];

      await client.query(
        `INSERT INTO inspection_history (
           inspection_id, actor_id, action, previous_status, new_status, note
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          inspection.id,
          inspector_id,
          'Filed — no defects',
          'Open',
          'Closed',
          'All checklist items passed — no contractor assignment required.',
        ]
      );
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

// Every inspection the user originated — resident complaints they filed or lift
// inspections they performed — newest first (HLD §6.2 /my).
//
// Deliberately NOT filtered on is_deleted. That flag is only ever set by a
// close (manual, or the G6 zero-defect auto-file), so it means "archived out of
// the active queues", not "deleted". Filtering it here hid a resident's own
// resolved complaints and — once G6 landed — made a clean spot-check vanish the
// instant the inspector filed it, leaving them no proof the check was recorded.
// The active-queue views (findAllForManager, findForStatusBoard) still exclude
// archived records; this is a person's own history, so it shows everything.
async function findByOriginator(userId) {
  const result = await query(
    `SELECT * FROM inspections
     WHERE resident_id = $1 OR inspector_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// Manager triage queue (UC-002), and — with archived: true — the closed-record
// history view. `status` may be a single value or a comma-separated list, so
// the queue's status-group tabs ("Needs action" = Open,Pending Assignment) can
// be expressed as one filter while single-status drill-through links still work.
//
// Archived records are ordered by when they closed, since priority score is
// meaningless once the work is done; the live queue stays most-urgent-first.
async function findAllForManager({ status, category, block, contractor, overdue, archived = false, sort } = {}) {
  const params = [archived];
  const where = [`is_deleted = $${params.length}`];

  const statuses = (Array.isArray(status) ? status : String(status ?? '').split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  if (statuses.length > 0) {
    params.push(statuses);
    where.push(`status = ANY($${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (block) {
    params.push(block);
    where.push(`location_block = $${params.length}`);
  }
  // Drill-through from the UC-005 contractor scorecard. Filter by contractor
  // NAME, matching how the scorecard groups, so the link stays human-readable.
  if (contractor) {
    params.push(contractor);
    where.push(`contractor_id IN (SELECT id FROM contractors WHERE name = $${params.length})`);
  }
  // "Overdue" uses the scorecard's definition: past deadline and not held —
  // a hold pauses the rectification clock (G11), so held work is not late.
  // A hold is an audit-trail fact rather than a status now, hence onHoldSql.
  if (overdue) {
    where.push(
      `target_deadline < NOW()
         AND status NOT IN ('Rectified', 'Resolved', 'Closed')
         AND NOT ${onHoldSql('inspections')}`
    );
  }

  // Archived (the history page) always sorts by when the record closed —
  // priority score is meaningless once the work is done. The live queue's
  // default is most-urgent-first (AI priority score); the "All open" tab
  // overrides that to newest-first (`sort=recent`), and the manager can
  // explicitly ask for either priority direction from any tab. Fixed set of
  // literal ORDER BY clauses selected by strict equality, not built from the
  // param, so there's nothing here for `sort` to inject.
  let orderBy;
  if (archived) {
    orderBy = 'closed_at DESC NULLS LAST, created_at DESC';
  } else if (sort === 'recent') {
    orderBy = 'created_at DESC';
  } else if (sort === 'priority_critical_first' || sort === 'priority_low_first') {
    const direction = sort === 'priority_critical_first' ? 'ASC' : 'DESC';
    orderBy = `CASE priority
                 WHEN 'Critical' THEN 1
                 WHEN 'High' THEN 2
                 WHEN 'Medium' THEN 3
                 WHEN 'Low' THEN 4
                 ELSE 5
               END ${direction}, created_at DESC`;
  } else {
    orderBy = 'ai_priority_score DESC NULLS LAST, created_at DESC';
  }

  const result = await query(
    `SELECT * FROM inspections
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy}`,
    params
  );
  return result.rows;
}

// Full detail for the manager view: the row plus its audit history (actor names
// joined from users), its checklist results (with the template's section/text
// and both the defect and completion photos, for the UC-004 joint endorsement),
// its signatures, and, for a CV-linked record (UC-007), the underlying
// cv_detections row (bounding_box/defect_class/confidence) so the frontend can
// draw the overlay — null when this record has no cv_detection_id.
// Returns undefined only when the id doesn't exist at all — unlike findById,
// this deliberately has NO is_deleted filter, so a closed/archived record is
// still viewable (there was previously no way to see one anywhere in the
// app). findById itself stays filtered: it backs the close/markReviewed
// mutation guards, which must keep rejecting an already-archived record.
// Note: the reporter is identified by block/unit only — no resident-name join.
async function findDetailById(id) {
  const result = await query('SELECT * FROM inspections WHERE id = $1', [id]);
  const inspection = result.rows[0];
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

  // Checklist results with their template text, so the manager can see what was
  // inspected — and, for defects, the original photo against the contractor's
  // completion photo. Ordered by the paper form's own numbering.
  const checklist_results = await query(
    `SELECT r.*, c.section, c.item_text, c.display_order
     FROM checklist_results r
     JOIN checklist_items c ON c.id = r.checklist_item_id
     WHERE r.inspection_id = $1
     ORDER BY c.display_order`,
    [id]
  );

  // Who signed and when (UC-015: signatures are retained for the audit trail).
  const signatures = await signatureModel.findByInspection(id);

  return {
    ...inspection,
    history: history.rows,
    cv_detection,
    checklist_results: checklist_results.rows,
    signatures,
  };
}

// Reject a contractor's rectification (UC-004 Alt 4): send the record back to
// the contractor with a fresh 14-day clock and a reason, atomically. Prior
// signatures are untouched — the signatures table is append-only, so the
// contractor's original sign-off is retained alongside the rejection (G20).
// The per-item completion proof is cleared so the contractor must resubmit it,
// which is also what makes G8 bite again on the next close attempt.
// Returns the updated row, or undefined when the id doesn't match a live
// record, or the string 'INVALID_STATE' when it isn't awaiting endorsement.
async function rejectRectification(id, reason, actorId) {
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
    if (before.status !== 'Rectified') {
      await client.query('ROLLBACK');
      return 'INVALID_STATE';
    }

    const updated = await client.query(
      `UPDATE inspections
          SET status = 'Assigned',
              reopen_count = reopen_count + 1,
              rectified_at = NULL,
              target_deadline = NOW() + INTERVAL '14 days',
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id]
    );

    // The work is not accepted, so the proof of completion goes with it.
    await client.query(
      `UPDATE checklist_results
          SET rectified = FALSE, completion_photo_url = NULL
        WHERE inspection_id = $1 AND result = 'Defect'`,
      [id]
    );

    await client.query(
      `INSERT INTO inspection_history (
         inspection_id, actor_id, action, previous_status, new_status, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actorId, 'Rectification Rejected', before.status, 'Assigned', reason]
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

// Inspector checks the contractor's work: 'Rectified' → 'Resolved'.
//
// This used to write an audit row and nothing else, so a record sat in
// "Pending View By Inspector" even after the inspector had looked at it, and
// only the manager's close moved it on. The inspector's review is what resolves
// a defect now; the manager's close then archives it.
//
// Returns the updated row, undefined when the id doesn't match a live record,
// or 'INVALID_STATE' when the record isn't awaiting review.
async function markReviewed(id, note, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: beforeRows } = await client.query(
      'SELECT * FROM inspections WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
      [id]
    );
    const before = beforeRows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return undefined;
    }
    if (before.status !== 'Rectified') {
      await client.query('ROLLBACK');
      return 'INVALID_STATE';
    }

    // id last, matching updateByManager's `WHERE id = $N` shape.
    const updated = await client.query(
      `UPDATE inspections SET status = $1, updated_at = NOW()
        WHERE id = $2 RETURNING *`,
      ['Resolved', id]
    );
    await client.query(
      `INSERT INTO inspection_history (
         inspection_id, actor_id, action, previous_status, new_status, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actorId, 'Reviewed by Inspector', before.status, 'Resolved', note || null]
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

// Has an inspector marked this record as reviewed? The review is an audit row
// rather than a column (markReviewed above), so the close gate asks the audit
// trail. Any inspector's review counts — resident complaints have no inspector
// of their own, so requiring the record's own would make them uncloseable.
async function hasInspectorReview(inspectionId) {
  const result = await query(
    `SELECT 1 FROM inspection_history
     WHERE inspection_id = $1 AND action = 'Reviewed by Inspector'
     LIMIT 1`,
    [inspectionId]
  );
  return result.rows.length > 0;
}

// Defect rows on a record that are not yet signed off (G8): either not marked
// rectified, or rectified without the contractor's proof photo. Returns the
// paper form's item numbers so the caller can name them in the error.
async function findUnrectifiedDefects(inspectionId) {
  const result = await query(
    `SELECT c.display_order, c.item_text
     FROM checklist_results r
     JOIN checklist_items c ON c.id = r.checklist_item_id
     WHERE r.inspection_id = $1
       AND r.result = 'Defect'
       AND (r.rectified = FALSE OR r.completion_photo_url IS NULL)
     ORDER BY c.display_order`,
    [inspectionId]
  );
  return result.rows;
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
    const fields = [
      'priority', 'status', 'contractor_id', 'target_deadline', 'hold_reason', 'category',
    ];
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
    //
    // A contractor change is 'Reassigned' when the record already had a different
    // contractor, and 'Assigned' only the first time (UC-015's required action
    // list has both). Setting the same contractor again is not a reassignment, so
    // it keeps the 'Assigned' label rather than inventing a transition.
    const isReassignment =
      changes.contractor_id !== undefined &&
      before.contractor_id != null &&
      // String compare: the request's id arrives as text, the DB's as a number.
      String(before.contractor_id) !== String(changes.contractor_id);
    const action = changes.contractor_id !== undefined
      ? (isReassignment ? 'Reassigned' : 'Assigned')
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
    // previous_contractor_id lets the caller tell a first assignment from a
    // reassignment (different email wording, and the outgoing contractor has to
    // be told the job was pulled).
    return {
      ...after,
      previous_status: before.status,
      previous_contractor_id: before.contractor_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Close a record (UC-004): set the closing fields + computed resolution time,
// archive it (is_deleted = TRUE for the 5-year audit trail), store the
// manager's signature, and write a 'Closed by Manager' audit row — all
// atomically.
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

    for (const sig of signatures) {
      await signatureModel.create({ inspection_id: id, ...sig }, client);
    }

    await client.query(
      `INSERT INTO inspection_history (
         inspection_id, actor_id, action, previous_status, new_status, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actorId, 'Closed by Manager', before.status, 'Closed', closing_remark]
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

// Contractor acknowledges a defect (UC-010 step 3): stamp acknowledged_at and
// write an audit row. Returns the updated row, or undefined when the record
// isn't a live defect assigned to this contractor.
//
// No status change: a record stays 'Assigned' from the moment a manager assigns
// it until the contractor finishes. Accepting the job is a fact about the job,
// not a new state of the record — it lives in acknowledged_at and the audit
// trail, where nothing is lost.
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
       SET acknowledged_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query(
      `INSERT INTO inspection_history
         (inspection_id, actor_id, action, previous_status, new_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, actorId, 'Acknowledged', before.status, before.status]
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
//   • finalize → status 'Rectified' (shown as "Pending View By Inspector"),
//     stamp rectified_at, store the contractor e-signature, audit
//     'Rectified & Signed' (the full completion).
//   • partial  → no status change, audit 'Work Progress Saved', no signature.
//     The record stays 'Assigned' in the contractor's inbox until every item is
//     done and they finalize.
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
      // Partial save leaves the status alone — the record is still 'Assigned'
      // work in progress, and saying so twice (once as a status, once in the
      // audit trail) is what produced the extra states. The history row is the
      // record that progress was saved.
      updated = await client.query(
        `UPDATE inspections SET updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      );
      await client.query(
        `INSERT INTO inspection_history
           (inspection_id, actor_id, action, previous_status, new_status, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, actorId, 'Work Progress Saved', before.status, before.status, note]
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

// Contractor puts a defect on hold (UC-010 Alt Flow A): records the reason; the
// deadline countdown pauses (the frontend hides it while held).
// Returns the updated row, or undefined when it isn't assigned to this contractor.
//
// The hold is no longer a status — the record stays 'Assigned'. It lives in
// hold_reason plus the 'On Hold' audit row, and utils/onHold.js derives "held"
// from that row for the overdue and chase queries that must skip it.
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
       SET hold_reason = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, hold_reason]
    );
    await client.query(
      `INSERT INTO inspection_history
         (inspection_id, actor_id, action, previous_status, new_status, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actorId, 'On Hold', before.status, before.status, hold_reason]
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

// Contractor resumes a held defect (UC-010 Alt Flow A, second half — G11).
// Clears hold_reason and pushes target_deadline out by however long the hold
// lasted, so time spent waiting on site access or a part is not counted against
// the contractor. No status to restore — the record never left 'Assigned'.
//
// The hold's start time is read from the append-only audit trail rather than a
// dedicated column: holdByContractor writes its 'On Hold' row in the same
// transaction, so that row's created_at *is* the moment the clock stopped.
// Avoids a schema change, and the value cannot drift from the history the
// record already shows. The most recent 'On Hold' row is used, so a record held
// more than once extends correctly each time.
//
// Returns the updated row, undefined when the record isn't this contractor's, or
// the string 'INVALID_STATE' when it isn't actually on hold.
async function resumeByContractor(id, contractorId, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await lockAssigned(client, id, contractorId);
    if (!before) {
      await client.query('ROLLBACK');
      return undefined;
    }
    // "Held" is now the most recent of the 'On Hold' / 'Resumed' pair, not a
    // status — the same rule utils/onHold.js applies in SQL. Reading the row
    // here serves both jobs: the guard, and the hold's start time.
    const { rows: holdRows } = await client.query(
      `SELECT action, created_at
         FROM inspection_history
        WHERE inspection_id = $1 AND action IN ('On Hold', 'Resumed')
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [id]
    );
    const hold = holdRows[0];
    if (hold?.action !== 'On Hold') {
      await client.query('ROLLBACK');
      return 'INVALID_STATE';
    }
    const heldSince = hold.created_at;

    const updated = await client.query(
      `UPDATE inspections
          SET hold_reason = NULL,
              target_deadline = CASE
                WHEN $2::timestamp IS NULL THEN target_deadline
                ELSE target_deadline + (NOW() - $2::timestamp)
              END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, heldSince]
    );

    const heldDays =
      Math.round(((Date.now() - new Date(heldSince).getTime()) / 86400000) * 10) / 10;
    await client.query(
      `INSERT INTO inspection_history
         (inspection_id, actor_id, action, previous_status, new_status, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        actorId,
        'Resumed',
        before.status,
        before.status,
        `Resumed after ${heldDays} day(s) on hold; deadline extended by the same period.`,
      ]
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
// Privacy guard (tested in inspections.integration.test.js): title and
// description are free text a resident wrote themselves and can incidentally
// contain identifying details, so they — along with resident_id, unit, and
// photo — never appear here. updated_at is just a timestamp, safe to include.
async function findForStatusBoard() {
  const result = await query(
    `SELECT id, location_block, category, status, created_at, updated_at
     FROM inspections
     WHERE source_type = 'resident_complaint' AND is_deleted = FALSE
     ORDER BY created_at DESC`
  );
  return result.rows;
}

// Cached translation for one (inspection, target language) pair, or undefined
// if nobody has asked for that pair yet. A cache read/write, not a source of
// truth — `inspections.title`/`description` are never touched by either.
async function findTranslation(inspectionId, targetLanguage) {
  const result = await query(
    `SELECT title, description, was_translated
       FROM inspection_translations
      WHERE inspection_id = $1 AND target_language = $2`,
    [inspectionId, targetLanguage]
  );
  return result.rows[0];
}

// Persist a translation so the next viewer who shares this target language
// gets the cached copy instead of another OpenAI call. ON CONFLICT rather than
// a prior existence check: two requests for the same never-yet-cached pair
// (two managers opening the same record moments apart) would otherwise race
// to insert and one would 500 on the UNIQUE constraint.
async function saveTranslation(inspectionId, targetLanguage, { title, description, was_translated }) {
  await query(
    `INSERT INTO inspection_translations
       (inspection_id, target_language, title, description, was_translated)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (inspection_id, target_language)
     DO UPDATE SET title = $3, description = $4, was_translated = $5, created_at = NOW()`,
    [inspectionId, targetLanguage, title, description, was_translated]
  );
}

// The resident-facing half of the same cache row (048): the closing remark,
// checklist remarks and history notes other people wrote — kept in separate
// columns from title/description/was_translated above so the two halves
// never overwrite each other, whichever side asks first.
async function findExtrasTranslation(inspectionId, targetLanguage) {
  const result = await query(
    `SELECT closing_remark, checklist_remarks, history_notes, extras_was_translated
       FROM inspection_translations
      WHERE inspection_id = $1 AND target_language = $2
        AND extras_was_translated IS NOT NULL`,
    [inspectionId, targetLanguage]
  );
  return result.rows[0];
}

async function saveExtrasTranslation(
  inspectionId,
  targetLanguage,
  { closing_remark, checklist_remarks, history_notes, was_translated }
) {
  await query(
    `INSERT INTO inspection_translations
       (inspection_id, target_language, closing_remark, checklist_remarks, history_notes, extras_was_translated)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (inspection_id, target_language)
     DO UPDATE SET closing_remark = $3, checklist_remarks = $4, history_notes = $5,
                   extras_was_translated = $6, created_at = NOW()`,
    [
      inspectionId,
      targetLanguage,
      closing_remark,
      JSON.stringify(checklist_remarks),
      JSON.stringify(history_notes),
      was_translated,
    ]
  );
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
  resumeByContractor,
  findByOriginator,
  findByResident,
  findDetailById,
  findForStatusBoard,
  findUnrectifiedDefects,
  markReviewed,
  hasInspectorReview,
  rejectRectification,
  queueRecurrenceJob,
  updateByManager,
  updatePriority,
  findTranslation,
  saveTranslation,
  findExtrasTranslation,
  saveExtrasTranslation,
};
