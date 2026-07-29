// Inspection controllers. UC-001: a resident files a complaint with an optional
// photo, which is AI-categorised; an inspector files a lift spot-check with
// checklist results. (Assign/close/rate land later.)
'use strict';

const { query } = require('../config/db');
const inspectionModel = require('../models/inspectionModel');
const liftModel = require('../models/liftModel');
const cloudinaryService = require('../services/cloudinaryService');
const openaiService = require('../services/openaiService');
const cvController = require('./cvController');
const socketService = require('../services/socketService');

// Schema enums (migration 004 CHECKs) for PATCH validation.
const STATUSES = [
  'Open', 'Pending Assignment', 'Assigned', 'Acknowledged',
  'On Hold', 'Rectified', 'Resolved', 'Closed',
];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// Optional GPS fields captured client-side on explicit tap. Supplementary
// metadata only — they never override or populate block/lift selection.
// Multipart fields arrive as strings; absent/empty ones become NULL.
function gpsFields(body) {
  const pick = (v) => (v === undefined || v === '' ? undefined : v);
  return {
    gps_lat: pick(body.gps_lat),
    gps_lng: pick(body.gps_lng),
    gps_accuracy_m: pick(body.gps_accuracy_m),
    gps_captured_at: pick(body.gps_captured_at),
  };
}

// POST /api/inspections — resident submits a new complaint (source_type
// 'resident_complaint'). Inspector/lift-inspection flows are out of scope here.
async function create(req, res, next) {
  try {
    const resident_id = req.user.id;
    const { title, description, location_block, location_unit } = req.body;

    // Minimal required-field validation.
    if (!title || !description || !location_block) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'title, description and location_block are required.',
      });
    }

    // Duplicate guard: same resident + title within the last 2 minutes is almost
    // certainly a double submit. One-off query, so it lives here rather than in
    // the model (which stays to its three UC-001 methods for now).
    const dup = await query(
      `SELECT id FROM inspections
       WHERE resident_id = $1 AND title = $2
         AND is_deleted = FALSE
         AND created_at > NOW() - INTERVAL '2 minutes'
       LIMIT 1`,
      [resident_id, title]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({
        code: 'DUPLICATE_SUBMISSION',
        message: 'You already submitted an incident with this title moments ago.',
      });
    }

    // Optional photo → Cloudinary (defects folder). multer puts it on req.file.
    let photo_url;
    if (req.file) {
      photo_url = await cloudinaryService.uploadImage(req.file.buffer, 'defects');
    }

    // AI categorisation (currently stubbed).
    const { category, priority_score } = await openaiService.categoriseIncident(
      title,
      description
    );

    const inspection = await inspectionModel.create({
      source_type: 'resident_complaint',
      resident_id,
      title,
      description,
      location_block,
      location_unit,
      photo_url,
      category,
      ai_priority_score: priority_score,
      ...gpsFields(req.body),
    });

    // CV defect detection on the same photo (UC-007), fired asynchronously so
    // it never blocks the resident's submission. On a high-confidence match
    // it creates its own separate cv_auto_detected ticket; a Roboflow rate
    // limit queues the image to retry_queue, linked back to this inspection.
    // Other failures are logged only.
    if (photo_url) {
      cvController
        .detect(photo_url, 'resident_upload', {
          location_block,
          location_unit,
          inspection_id: inspection.id,
        })
        .catch((err) => console.error('CV detection failed:', err.message));
    }

    res.status(201).json(inspection);
  } catch (err) {
    next(err);
  }
}

// POST /api/inspections/lift — inspector submits a lift spot-check (multipart:
// `lift_id` + `checklist` [JSON string of { checklist_item_id, result,
// severity?, remark? }] fields, plus optional `photo_<checklist_item_id>` file
// parts for Defect rows). Note: HLD §6.2 folds this into POST /api/inspections
// via source_type; it lives on a sibling route here so the inspector role guard
// stays route-level and the resident path stays untouched. No OpenAI
// categorisation and no duplicate guard (that guard protects against resident
// double-submits).
async function createLiftInspection(req, res, next) {
  try {
    const inspector_id = req.user.id;
    const { lift_id } = req.body;

    // checklist arrives as a JSON string field alongside the file parts.
    let checklist;
    try {
      checklist = JSON.parse(req.body.checklist);
    } catch {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'checklist must be a valid JSON array.',
      });
    }

    // Required fields: a lift and a non-empty checklist.
    if (!lift_id || !Array.isArray(checklist) || checklist.length === 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'lift_id and a non-empty checklist array are required.',
      });
    }

    // Each result row must reference a template item and be Pass/Defect;
    // severity is optional but constrained (mirrors the schema CHECKs).
    for (const item of checklist) {
      if (!item.checklist_item_id || !['Pass', 'Defect'].includes(item.result)) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message:
            'Each checklist entry needs a checklist_item_id and a result of Pass or Defect.',
        });
      }
      if (item.severity && !['Minor', 'Major', 'Critical'].includes(item.severity)) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'severity must be Minor, Major or Critical.',
        });
      }
    }

    const lift = await liftModel.findById(lift_id);
    if (!lift) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Lift not found.',
      });
    }

    // Per-item photos: file parts named photo_<checklist_item_id>. Upload to
    // Cloudinary (defects folder) and attach the URL to the matching Defect
    // entry; files for Pass/unknown items are ignored.
    const byItemId = new Map(checklist.map((item) => [item.checklist_item_id, item]));
    for (const file of req.files ?? []) {
      const match = /^photo_(.+)$/.exec(file.fieldname);
      if (!match) continue;
      const item = byItemId.get(match[1]);
      if (item && item.result === 'Defect') {
        item.photo_url = await cloudinaryService.uploadImage(file.buffer, 'defects');
      }
    }

    // Derived server-side from the lift: block, responsible contractor, and a
    // title (inspections.title is NOT NULL; the HLD lift request has none).
    const inspection = await inspectionModel.createLiftInspection({
      inspector_id,
      lift_id,
      title: `Lift inspection — ${lift.lift_code}`,
      location_block: lift.block_number,
      contractor_id: lift.contractor_id,
      checklist,
      ...gpsFields(req.body),
    });

    res.status(201).json(inspection);
  } catch (err) {
    next(err);
  }
}

// GET /api/inspections/my — the caller's own reports (resident complaints they
// filed / lift inspections they performed). Wrapped as { data } per HLD §6.2.
async function listMine(req, res, next) {
  try {
    const data = await inspectionModel.findByOriginator(req.user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// GET /api/inspections/status-board — privacy-safe estate-wide complaint feed
// (block/category/status/date only; the model's allow-list guarantees no
// identifying fields). Any authenticated user may read it.
async function listStatusBoard(req, res, next) {
  try {
    const data = await inspectionModel.findForStatusBoard();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// GET /api/inspections — manager triage queue (UC-002): all records, optional
// ?status=&category=&block= filters, most urgent first. { data, total } per HLD.
async function listForManager(req, res, next) {
  try {
    const { status, category, block } = req.query;
    const data = await inspectionModel.findAllForManager({ status, category, block });
    res.json({ data, total: data.length });
  } catch (err) {
    next(err);
  }
}

// GET /api/inspections/:id — full record + audit history for the manager
// detail view. Reporter shown by block/unit only (no name join by design).
async function getDetail(req, res, next) {
  try {
    const inspection = await inspectionModel.findDetailById(req.params.id);
    if (!inspection) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Inspection not found.' });
    }
    res.json(inspection);
  } catch (err) {
    next(err);
  }
}

// PATCH /api/inspections/:id — manager triage (UC-002): set priority, status,
// contractor assignment, deadline, or hold reason. Writes an inspection_history
// audit row and pushes a `status_update` socket event so originators see the
// change live (Zoe's UC-003 layer listens for it).
async function updateInspection(req, res, next) {
  try {
    const { priority, status, contractor_id, target_deadline, hold_reason, note } = req.body;

    const changes = { priority, status, contractor_id, target_deadline, hold_reason };
    const hasChange = Object.values(changes).some((v) => v !== undefined);
    if (!hasChange) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one field to update.',
      });
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `status must be one of: ${STATUSES.join(', ')}.`,
      });
    }
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `priority must be one of: ${PRIORITIES.join(', ')}.`,
      });
    }

    // Assigning a contractor: verify it exists, and apply the UC-002 defaults —
    // status moves to Assigned and the 14-day rectification deadline starts.
    if (contractor_id !== undefined) {
      const { rows } = await query('SELECT id FROM contractors WHERE id = $1', [contractor_id]);
      if (rows.length === 0) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Contractor not found.' });
      }
      if (changes.status === undefined) changes.status = 'Assigned';
      if (changes.target_deadline === undefined) {
        changes.target_deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    const inspection = await inspectionModel.updateByManager(
      req.params.id,
      changes,
      req.user.id,
      note
    );
    if (!inspection) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Inspection not found.' });
    }

    // Real-time push; a socket hiccup must never fail the HTTP update.
    try {
      socketService.emitToRooms(
        // insp-{id}: the originator's own room (UC-003) — a resident's block room
        // is too broad and an inspector isn't in one at all.
        ['manager-room', `block-${inspection.location_block}`, `insp-${inspection.id}`],
        'status_update',
        {
          id: inspection.id,
          status: inspection.status,
          priority: inspection.priority,
          updated_at: inspection.updated_at,
        }
      );
    } catch {
      // Socket not initialised (e.g. tests) or emit failed — ignore.
    }

    res.json(inspection);
  } catch (err) {
    next(err);
  }
}

// POST /api/inspections/:id/close — manager closes a record (UC-004) with a
// mandatory remark, dual e-signature (manager + endorser), and optional cost.
// Multipart: closing_remark, actual_cost?, endorser_role, endorser_id text
// fields + manager_signature & endorser_signature PNG parts. This is separate
// from PATCH /:id (which deliberately excludes 'Closed') because closing has its
// own validation, signature capture, and archival (is_deleted = TRUE).
async function closeInspection(req, res, next) {
  try {
    const { closing_remark, actual_cost, endorser_role, endorser_id } = req.body;

    // Remark: mandatory, at least 10 characters (trimmed).
    if (!closing_remark || closing_remark.trim().length < 10) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Closing remark must be at least 10 characters.',
      });
    }

    // actual_cost: optional, but if present must be a non-negative number.
    let cost = null;
    if (actual_cost !== undefined && actual_cost !== '') {
      cost = Number(actual_cost);
      if (Number.isNaN(cost) || cost < 0) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'actual_cost must be a non-negative number.',
        });
      }
    }

    // Endorser: the second signature is attributed to a real user.
    if (!['inspector', 'contractor'].includes(endorser_role)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'endorser_role must be inspector or contractor.',
      });
    }
    if (!endorser_id) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'endorser_id is required.',
      });
    }

    // Both signature images are required (dual endorsement).
    const managerFile = req.files?.manager_signature?.[0];
    const endorserFile = req.files?.endorser_signature?.[0];
    if (!managerFile || !endorserFile) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Both manager_signature and endorser_signature images are required.',
      });
    }

    // The record must be a live, un-closed inspection.
    const existing = await inspectionModel.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Inspection not found or already closed.',
      });
    }

    // The endorser must be a real user (signatures.signer_id FK).
    const endorser = await query('SELECT id FROM users WHERE id = $1', [endorser_id]);
    if (endorser.rows.length === 0) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Endorser user not found.' });
    }

    // Store both signatures in Cloudinary (/signatures folder).
    const [managerUrl, endorserUrl] = await Promise.all([
      cloudinaryService.uploadImage(managerFile.buffer, 'signatures'),
      cloudinaryService.uploadImage(endorserFile.buffer, 'signatures'),
    ]);

    const inspection = await inspectionModel.closeInspection(
      req.params.id,
      {
        closing_remark: closing_remark.trim(),
        actual_cost: cost,
        signatures: [
          { signer_role: 'manager', signer_id: req.user.id, image_url: managerUrl },
          { signer_role: endorser_role, signer_id: endorser_id, image_url: endorserUrl },
        ],
      },
      req.user.id
    );
    if (!inspection) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Inspection not found or already closed.',
      });
    }

    // Recurrence queue + live push — both best-effort, never fail the close.
    try {
      await inspectionModel.queueRecurrenceJob(
        inspection.id,
        inspection.location_block,
        inspection.category
      );
    } catch {
      // Analytics queue is non-critical to the close.
    }
    try {
      // admin-room included: a close carries actual_cost, which the UC-011
      // cost dashboard watches for its live-update prompt.
      socketService.emitToRooms(
        [
          'manager-room',
          'admin-room',
          `block-${inspection.location_block}`,
          `insp-${inspection.id}`,
        ],
        'status_update',
        { id: inspection.id, status: inspection.status, updated_at: inspection.updated_at }
      );
    } catch {
      // Socket not initialised (e.g. tests) — ignore.
    }

    res.json({
      id: inspection.id,
      status: inspection.status,
      is_deleted: inspection.is_deleted,
      resolution_time_hours: inspection.resolution_time_hours,
      closed_at: inspection.closed_at,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  closeInspection,
  create,
  createLiftInspection,
  getDetail,
  listForManager,
  listMine,
  listStatusBoard,
  updateInspection,
};
