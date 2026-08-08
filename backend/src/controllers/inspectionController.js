// Inspection controllers. UC-001: a resident files a complaint with an optional
// photo, which is AI-categorised; an inspector files a lift spot-check with
// checklist results. (Assign/close/rate land later.)
'use strict';

const { query } = require('../config/db');
const inspectionModel = require('../models/inspectionModel');
const defectEmailModel = require('../models/defectEmailModel');
const liftModel = require('../models/liftModel');
const checklistItemModel = require('../models/checklistItemModel');
const cloudinaryService = require('../services/cloudinaryService');
const openaiService = require('../services/openaiService');
const emailService = require('../services/emailService');
const cvController = require('./cvController');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const config = require('../config/env');
// Categories a resident picks on the report form and a manager can correct
// during triage (migration 042).
const { CATEGORIES } = require('../utils/inspectionOptions');

// Schema enums (migration 004 CHECKs) for PATCH validation.
const STATUSES = [
  'Open', 'Pending Assignment', 'Assigned', 'Acknowledged',
  'On Hold', 'Rectified', 'Resolved', 'Closed',
];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// HLD 14-day rectification rule, used whenever a deadline is left unset.
// New records get the same window from the `inspections` column default
// (migration 025).
function deadlineIn14Days() {
  return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
}

// --- UC-008 notification helpers -------------------------------------------
// Additive only: these produce durable bell notifications alongside the existing
// status_update emits, which are left exactly as they are. notifyEvent never
// throws (G13), so nothing below can affect a transition that already committed.

// The contractor's login + room for a record, so the assignee can actually be
// told. Separate from the existing contact_email lookup, which stays untouched.
// Returns null when the contractor has no linked login (UC-014 A4) — managers
// are still notified, the assignment still proceeds.
async function contractorRecipient(contractorId) {
  if (!contractorId) return null;
  const { rows } = await query(
    'SELECT user_id, name FROM contractors WHERE id = $1',
    [contractorId]
  );
  const row = rows[0];
  if (!row?.user_id) return null;
  return {
    scope: { type: 'users', user_ids: [row.user_id], rooms: [`contractor-${row.user_id}`] },
    name: row.name,
  };
}

// --- UC-014 outbound defect email (D.3 / D.7) ------------------------------
// Where a defect email is addressed: the vendor's account holder, i.e. the
// person who can actually sign in and action it from /contractor-inbox. The
// company alias (contractors.contact_email) is only the fallback, for a vendor
// with no linked login or whose account is suspended — the link in that mail
// still lands on the login page, but at least somebody receives it.
const CONTRACTOR_RECIPIENT_SQL =
  `SELECT c.id, c.user_id,
          COALESCE(u.email, c.contact_email) AS contact_email
     FROM contractors c
     LEFT JOIN users u ON u.id = c.user_id AND u.status = 'active'
    WHERE c.id = $1`;

// The single place a defect email is sent and recorded, so the spot-check alert
// and the daily overdue chase cannot drift apart.
//
// defect_email_log is written either way: 'sent' on delivery, 'failed' with the
// reason when there is nobody to email (A4) or SMTP throws. The G12 stamp and the
// audit row are written only on a successful send — an audit trail claiming an
// alert went out when it didn't is worse than no row at all.
//
// Never throws (G13): every caller has already committed its state change, so a
// mail or logging problem must not turn a successful transition into a 500.
//
// Returns 'sent' | 'failed' | 'skipped' ('skipped' = no contractor to email).
async function deliverDefectEmail(inspection, {
  email_type,
  contact_email,
  defects = [],
  lift_code,
  days_remaining,
  reason,
  auditAction,
  actorId = null,
}) {
  // No contractor at all: there is no addressee and no contractor_id to satisfy
  // defect_email_log's NOT NULL, so there is nothing to record.
  if (!inspection.contractor_id) return 'skipped';

  const logEntry = {
    inspection_id: inspection.id,
    contractor_id: inspection.contractor_id,
    email_type,
  };
  // Best-effort logging: a failed log write must not mask the send's outcome.
  const log = (fields) =>
    defectEmailModel.logEmail({ ...logEntry, ...fields }).catch((err) => {
      console.error('[inspectionController] defect_email_log write failed:', err.message);
    });

  // A4 — the vendor has no contact email, so the LC cannot be reached. No send is
  // attempted even when DEFECT_ALERT_RECIPIENTS is configured: that list is a
  // demo CC, and logging 'sent' because a copy reached the team would tell the
  // manager their contractor was notified when nobody was. The failure is logged
  // so the delivery chip can show "LC not reachable"; the record still
  // files/assigns normally.
  if (!contact_email) {
    await log({
      recipient: defectEmailModel.NO_RECIPIENT,
      status: 'failed',
      error_message: 'No contractor contact email on record (UC-014 A4).',
    });
    return 'failed';
  }

  const recipients = [contact_email];
  if (config.DEFECT_ALERT_RECIPIENTS) {
    recipients.push(config.DEFECT_ALERT_RECIPIENTS);
  }
  const to = recipients.join(',');

  try {
    await emailService.sendDefectAlert(inspection, to, {
      email_type,
      defects,
      lift_code,
      days_remaining,
      reason,
    });
  } catch (err) {
    console.error(`[inspectionController] ${email_type} email failed:`, err.message);
    await log({ recipient: to, status: 'failed', error_message: err.message });
    return 'failed';
  }

  await log({ recipient: to, status: 'sent' });
  try {
    // G12 applies to the one-shot spot-check alert only. The chase is meant to
    // fire repeatedly (D−3 then D+0), guarded per day instead.
    if (email_type === 'defect_alert') {
      await defectEmailModel.markDefectEmailSent(inspection.id);
    }
    if (auditAction) {
      await defectEmailModel.logEmailAudit(
        inspection.id,
        auditAction,
        inspection.status,
        actorId
      );
    }
  } catch (err) {
    console.error('[inspectionController] post-send bookkeeping failed:', err.message);
  }
  return 'sent';
}

// Who filed the record: a resident complaint is tracked by its author (UC-003),
// a spot-check by the inspector. insp-{id} is the originator's own room.
function originatorScope(inspection) {
  const userId = inspection.resident_id ?? inspection.inspector_id;
  if (!userId) return null;
  return { type: 'users', user_ids: [userId], rooms: [`insp-${inspection.id}`] };
}

function recordLabel(inspection) {
  return inspection.location_block
    ? `Blk ${inspection.location_block} — ${inspection.title}`
    : inspection.title;
}

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
    const { title, description, location_block, location_unit, category } = req.body;

    // Minimal required-field validation. The resident picks the category on the
    // form, so it is required alongside the rest — 'Miscellaneous' is the
    // honest answer when they are unsure, not a blank.
    if (!title || !description || !location_block || !category) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'title, description, location_block and category are required.',
      });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `category must be one of: ${CATEGORIES.join(', ')}.`,
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

    // The AI is still consulted for the priority score, but the resident's own
    // choice of category is what gets stored — a person looking at the defect
    // beats a guess made from its title (and beats CV, which never writes a
    // category onto an existing report).
    const { priority_score } = await openaiService.categoriseIncident(
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

    // A complaint sitting untriaged is the failure mode here — nothing told a
    // manager one had arrived. AI-scored high goes out as Critical so it stands
    // out in the bell.
    await notificationService.notifyEvent({
      event_type: 'complaint_submitted',
      scope: { type: 'managers' },
      message: `New resident report — ${recordLabel(inspection)}`,
      urgency: (inspection.ai_priority_score ?? 0) >= 80 ? 'Critical' : 'Informational',
      link: `/inspections/${inspection.id}`,
    });

    res.status(201).json(inspection);
  } catch (err) {
    next(err);
  }
}

// POST /api/inspections/lift — inspector submits a lift spot-check (multipart:
// `lift_id`, `serviced_at`, and `checklist` [JSON string of
// { checklist_item_id, result, severity?, remark? }] fields, plus
// `photo_<checklist_item_id>` file parts for Major/Critical defects and the
// inspector's `inspector_signature` part). Enforces HLD §11 guard rails G1–G5
// server-side: complete checklist, severity on every defect, photo rules by
// severity, the 100 KB cap (multer, see routes), and the "Checked by"
// signature.
// Note: HLD §6.2 folds this into POST /api/inspections
// via source_type; it lives on a sibling route here so the inspector role guard
// stays route-level and the resident path stays untouched. No OpenAI
// categorisation and no duplicate guard (that guard protects against resident
// double-submits).
async function createLiftInspection(req, res, next) {
  try {
    const inspector_id = req.user.id;
    // serviced_at = the paper form's "Servicing Date". Multipart sends it as a
    // 'YYYY-MM-DD' string; an absent/blank one stores NULL.
    const { lift_id } = req.body;
    const serviced_at = req.body.serviced_at === '' ? undefined : req.body.serviced_at;

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

    // G1: a lift, the servicing date, and a non-empty checklist are required.
    if (!lift_id || !serviced_at || !Array.isArray(checklist) || checklist.length === 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'lift_id, serviced_at and a non-empty checklist array are required.',
      });
    }

    // Each result row must reference a template item and be Pass/Defect.
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

    const byItemId = new Map(checklist.map((item) => [item.checklist_item_id, item]));

    // G1: every active template item must be answered. The paper form has no
    // blank rows, so a partial submission is rejected listing the item numbers
    // (display_order) still missing.
    const activeItems = await checklistItemModel.findActive();
    const missing = activeItems
      .filter((tpl) => !byItemId.has(tpl.id))
      .map((tpl) => tpl.display_order);
    if (missing.length > 0) {
      return res.status(400).json({
        code: 'INCOMPLETE_CHECKLIST',
        message: `Answer all ${activeItems.length} checklist items — missing item(s): ${missing.join(', ')}.`,
      });
    }

    // Reject ids that aren't part of the active template, so a stale or forged
    // client can't attach results to retired/unknown items.
    const activeIds = new Set(activeItems.map((tpl) => tpl.id));
    const unknown = checklist.filter((item) => !activeIds.has(item.checklist_item_id));
    if (unknown.length > 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'checklist references items that are not on the active template.',
      });
    }

    // Which items arrived with a photo part. Computed before any upload so a
    // rejected submission never leaves orphaned images in Cloudinary.
    const photoFiles = new Map();
    for (const file of req.files ?? []) {
      const match = /^photo_(.+)$/.exec(file.fieldname);
      if (match && byItemId.has(match[1])) photoFiles.set(match[1], file);
    }

    // G5: the paper form's "Checked by / Signature" box. Without it the record
    // carries no attestation, so it is rejected before anything is stored.
    const signatureFile = (req.files ?? []).find(
      (f) => f.fieldname === 'inspector_signature'
    );
    if (!signatureFile) {
      return res.status(400).json({
        code: 'SIGNATURE_REQUIRED',
        message: 'The inspector must sign before submitting the spot-check.',
      });
    }

    // Item number for error messages — the inspector sees the same numbering
    // as the paper form, not a UUID.
    const orderOf = new Map(activeItems.map((tpl) => [tpl.id, tpl.display_order]));

    // G2 + G3, per Defect row: severity is mandatory; Major/Critical must carry
    // a photo and Minor must not (the client's "no photos on minor issue" rule,
    // which keeps the platform fast and storage small).
    for (const item of checklist) {
      if (item.result !== 'Defect') continue;
      const itemNo = orderOf.get(item.checklist_item_id);

      if (!item.severity) {
        return res.status(400).json({
          code: 'SEVERITY_REQUIRED',
          message: `Item ${itemNo}: a defect must have a severity.`,
        });
      }
      const hasPhoto = photoFiles.has(item.checklist_item_id);
      if (item.severity === 'Minor' && hasPhoto) {
        return res.status(400).json({
          code: 'PHOTO_NOT_ALLOWED_FOR_MINOR',
          message: `Item ${itemNo}: minor defects must not carry a photo.`,
        });
      }
      if (item.severity !== 'Minor' && !hasPhoto) {
        return res.status(400).json({
          code: 'PHOTO_REQUIRED_FOR_SEVERITY',
          message: `Item ${itemNo}: a ${item.severity} defect requires a photo.`,
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

    // Validation passed — upload the per-item photos to Cloudinary (defects
    // folder) and attach each URL to its Defect entry.
    for (const [itemId, file] of photoFiles) {
      const item = byItemId.get(itemId);
      if (item.result === 'Defect') {
        item.photo_url = await cloudinaryService.uploadImage(file.buffer, 'defects');
      }
    }
    // The inspector's signature lives in its own folder, as on the close flow.
    const signature_url = await cloudinaryService.uploadImage(
      signatureFile.buffer,
      'signatures'
    );

    // G6: a spot-check with no defects involves no contractor at all — it is
    // filed as a compliant check (see the model's auto-file branch) and no
    // defect email is sent.
    const has_defects = checklist.some((item) => item.result === 'Defect');

    // Derived server-side from the lift: block, responsible contractor, and a
    // title (inspections.title is NOT NULL; the HLD lift request has none).
    const inspection = await inspectionModel.createLiftInspection({
      inspector_id,
      lift_id,
      title: `Lift inspection — ${lift.lift_code}`,
      location_block: lift.block_number,
      contractor_id: has_defects ? lift.contractor_id : null,
      checklist,
      serviced_at,
      signature_url,
      has_defects,
      ...gpsFields(req.body),
    });

    // Step 4 of the client's workflow — "finding on report (defect) will be
    // informed to lift servicing supervisor". This path previously produced no
    // in-app signal of any kind, so a submitted spot-check was invisible until
    // someone happened to open the queue.
    if (has_defects) {
      const defects = checklist.filter((item) => item.result === 'Defect');
      const worst = defects.some((d) => d.severity === 'Critical') ? 'Critical' : 'Warning';
      const summary = `${recordLabel(inspection)} — ${defects.length} defect(s) flagged`;

      await notificationService.notifyEvent({
        event_type: 'defects_flagged',
        scope: { type: 'managers' },
        message: `${summary}, awaiting assignment.`,
        urgency: worst,
        link: `/inspections/${inspection.id}`,
      });

      const assignee = await contractorRecipient(inspection.contractor_id);
      if (assignee) {
        await notificationService.notifyEvent({
          event_type: 'defects_flagged',
          scope: assignee.scope,
          message: `${summary} on a lift you service. Rectification is due within 2 weeks.`,
          urgency: worst,
          // ?defect= names the job. A contractor has no /inspections/:id page
          // (that route is manager+inspector only), so their link is the inbox
          // — and a bare inbox link left the bell opening the page with
          // whichever job happened to be selected. The inbox reads the param
          // and selects this record; an unknown or stale id falls back to the
          // normal selection, so an old link still lands somewhere sensible.
          link: `/contractor-inbox?defect=${inspection.id}`,
        });
      }

      // D.3 — the UC-014 email itself, which is the client's stated headline
      // benefit ("finding on report will be informed to lift servicing
      // supervisor"). Until now only the in-app notification above went out, so
      // a supervisor who never opens the portal learned nothing.
      //
      // Fired after the commit, on the ≥1 defect path only (G6 covers the clean
      // check), and skipped when defect_email_sent_at is already set (G12).
      // deliverDefectEmail never throws, so the 201 below is unaffected (G13).
      if (!inspection.defect_email_sent_at) {
        const emailDefects = await defectEmailModel
          .findDefectsForEmail(inspection.id)
          .catch((err) => {
            // Without the checkpoint rows the alert would be a bare summary,
            // which is not the D.2 email — better to log and send what we have.
            console.error('[inspectionController] defect table lookup failed:', err.message);
            return [];
          });

        const { rows: vendor } = await query(
          CONTRACTOR_RECIPIENT_SQL,
          [inspection.contractor_id]
        );

        await deliverDefectEmail(inspection, {
          email_type: 'defect_alert',
          contact_email: vendor[0]?.contact_email,
          defects: emailDefects,
          lift_code: lift.lift_code,
          auditAction: 'Defect Alert Sent',
          actorId: inspector_id,
        });
      }
    } else {
      // G6: filed as a compliant check. No contractor, no email — but the
      // manager still wants to see that the check happened.
      await notificationService.notifyEvent({
        event_type: 'spot_check_passed',
        scope: { type: 'managers' },
        message: `${recordLabel(inspection)} — spot-check passed with no defects, filed automatically.`,
        urgency: 'Informational',
        link: `/inspections/${inspection.id}`,
      });
    }

    // Live push (HLD §10) so the manager's queue and dashboard don't sit stale
    // while a spot-check lands. manager-room only, deliberately:
    //   • block-{n} holds residents, and findForStatusBoard excludes lift
    //     inspections — every resident in the block would refetch and see
    //     nothing new.
    //   • admin-room watches actual_cost, which a spot-check never carries
    //     (a G6 auto-file leaves it NULL, so it can't reach the cost figures).
    //   • insp-{id} has no members yet; clients join it on demand.
    // `inspection` is already the auto-closed row on the zero-defect path, so
    // this one emit reports 'Closed' there and 'Open' otherwise — no branch.
    try {
      socketService.emitToRooms(
        ['manager-room'],
        'status_update',
        { id: inspection.id, status: inspection.status, updated_at: inspection.updated_at }
      );
    } catch {
      // Socket not initialised (e.g. tests) — ignore (G13).
    }

    res.status(201).json(inspection);
  } catch (err) {
    next(err);
  }
}

// POST /api/inspections/ocr-prefill — UC-013: inspector photographs a
// completed paper form; OpenAI vision reads it into a draft the client can
// prefill onto the same checklist form createLiftInspection expects. G18:
// this never writes to inspections/checklist results/signatures — it only
// returns a draft. The inspector still confirms every field and submits
// through the normal POST /api/inspections/lift flow.
async function ocrPrefill(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'form_photo is required.',
      });
    }

    const activeItems = await checklistItemModel.findActive();
    const image_url = await cloudinaryService.uploadImage(req.file.buffer, 'ocr-scans');

    let draft;
    try {
      draft = await openaiService.extractSpotCheckForm(
        image_url,
        activeItems.map((tpl) => tpl.item_text)
      );
    } catch (err) {
      // A4: OpenAI itself is down/misconfigured/over quota — distinct from a
      // bad photo, so the client can disable the scan button instead of
      // inviting a retry that will just fail again.
      if (err.serviceUnavailable) {
        return res.status(503).json({
          code: 'OCR_SERVICE_UNAVAILABLE',
          message: 'The form-scan service is temporarily unavailable.',
        });
      }
      return res.status(422).json({
        code: 'OCR_UNREADABLE',
        message: `Could not read the form: ${err.message}`,
      });
    }

    // Map the model's positional items back onto the real template ids —
    // same order the prompt was built in, so index i is item i.
    const items = draft.items.map((entry, i) => ({
      checklist_item_id: activeItems[i].id,
      section: activeItems[i].section,
      item_text: activeItems[i].item_text,
      display_order: activeItems[i].display_order,
      result: entry.result,
      remark: entry.remark,
      field_confidence: entry.field_confidence,
    }));
    const unreadable_items = items
      .filter((item) => item.result === 'unreadable')
      .map((item) => item.display_order);

    res.json({
      serviced_at: draft.serviced_at,
      serviced_at_confidence: draft.serviced_at_confidence,
      form_lift_code: draft.form_lift_code,
      items,
      unreadable_items,
      disclaimer: 'Draft only — every field must be confirmed before submitting.',
    });
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
    const { status, category, block, contractor } = req.query;
    // ?archived=true switches to the closed-record history view. Anything else
    // (absent, 'false') keeps the default live queue. ?overdue=true narrows to
    // past-deadline work (scorecard drill-through); same true-string convention.
    const archived = req.query.archived === 'true';
    const overdue = req.query.overdue === 'true';
    const data = await inspectionModel.findAllForManager({
      status, category, block, contractor, overdue, archived,
    });
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
    const { priority, status, contractor_id, target_deadline, hold_reason, category, note } =
      req.body;

    const changes = { priority, status, contractor_id, target_deadline, hold_reason, category };
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
    // Triage can correct a category the resident picked wrongly.
    if (category !== undefined && !CATEGORIES.includes(category)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `category must be one of: ${CATEGORIES.join(', ')}.`,
      });
    }

    // Assigning a contractor: verify it exists, and apply the UC-002 defaults —
    // status moves to Assigned and the 14-day rectification deadline starts.
    let assignedContractorEmail = null;
    let assignedContractorUserId = null;
    if (contractor_id !== undefined) {
      const { rows } = await query(CONTRACTOR_RECIPIENT_SQL, [contractor_id]);
      if (rows.length === 0) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Contractor not found.' });
      }
      assignedContractorEmail = rows[0].contact_email;
      assignedContractorUserId = rows[0].user_id;
      if (changes.status === undefined) changes.status = 'Assigned';
      if (changes.target_deadline === undefined) changes.target_deadline = deadlineIn14Days();
    }

    // A deadline field submitted blank falls back to the same 14-day rule
    // rather than clearing the date.
    if (changes.target_deadline === '' || changes.target_deadline === null) {
      changes.target_deadline = deadlineIn14Days();
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

    // A reassignment is a contractor change on a record that already had a
    // (different) contractor — the outgoing one has to be told the job left
    // their inbox, and the incoming one gets reassignment wording rather than
    // the first-assignment mail. Setting the same contractor again is neither.
    const previousContractorId = inspection.previous_contractor_id;
    const isReassignment =
      contractor_id !== undefined &&
      previousContractorId != null &&
      // String compare: the body's id arrives as text, the DB's as a number.
      String(previousContractorId) !== String(contractor_id);
    const previousAssignee = isReassignment
      ? await contractorRecipient(previousContractorId)
      : null;

    // Real-time push; a socket hiccup must never fail the HTTP update.
    try {
      // insp-{id}: the originator's own room (UC-003) — a resident's block room
      // is too broad and an inspector isn't in one at all.
      const rooms = ['manager-room', `block-${inspection.location_block}`, `insp-${inspection.id}`];
      // D.5 — on assignment the contractor's own room gets the event too, so
      // their inbox refreshes instead of waiting for a manual reload. Keyed by
      // the account holder's users.id (contractors.user_id resolved above), NOT
      // the contractors row id: config/socket.js joins `contractor-${user.id}`.
      // A vendor with no linked login has no room; the assignment still stands.
      if (assignedContractorUserId) {
        rooms.push(`contractor-${assignedContractorUserId}`);
      }
      // The outgoing contractor's room too, otherwise a reassigned-away job sits
      // in their open inbox until they reload.
      if (previousAssignee) {
        rooms.push(...previousAssignee.scope.rooms);
      }
      socketService.emitToRooms(rooms, 'status_update', {
        id: inspection.id,
        status: inspection.status,
        priority: inspection.priority,
        updated_at: inspection.updated_at,
      });
    } catch {
      // Socket not initialised (e.g. tests) or emit failed — ignore.
    }

    // Defect-assignment alert: email the assigned contractor (LC), plus the
    // demo broadcast list (DEFECT_ALERT_RECIPIENTS) so the whole team sees it.
    // A mail failure must never fail the assignment (same policy as the socket).
    if (assignedContractorEmail !== null) {
      const recipients = [assignedContractorEmail];
      if (config.DEFECT_ALERT_RECIPIENTS) {
        recipients.push(config.DEFECT_ALERT_RECIPIENTS);
      }
      try {
        await emailService.sendDefectAlert(inspection, recipients.filter(Boolean).join(','),
          isReassignment ? { email_type: 'reassignment' } : {});
      } catch (err) {
        console.error('[inspectionController] Defect alert email failed:', err.message);
        // The manager is the only one who can chase an undelivered alert, and
        // until now the failure lived in the server log where nobody saw it
        // (UC-014 A4, the "LC not reachable" case).
        await notificationService.notifyEvent({
          event_type: 'defect_email_failed',
          scope: { type: 'managers' },
          message: `Defect alert email failed for ${recordLabel(inspection)} — the lift company was not reached.`,
          urgency: 'Warning',
          link: `/inspections/${inspection.id}`,
        });
      }
    }

    // Tell the assignee. The status_update emit above deliberately still goes
    // only to manager/block/insp rooms (D.5 is Philena's to change); this
    // notification reaches contractor-{user_id} independently, so the assignee
    // learns of the work either way.
    if (contractor_id !== undefined) {
      const assignee = await contractorRecipient(contractor_id);
      if (assignee) {
        await notificationService.notifyEvent({
          event_type: isReassignment ? 'defect_reassigned' : 'defect_assigned',
          scope: assignee.scope,
          message: `${recordLabel(inspection)} has been ${isReassignment ? 'reassigned' : 'assigned'} to you — due ${new Date(inspection.target_deadline).toLocaleDateString('en-SG')}.`,
          // Informational (D.13): being given work is the contractor's happy
          // path, not an exception. It was Warning, so every routine assignment
          // arrived looking like an escalation.
          urgency: 'Informational',
          link: `/contractor-inbox?defect=${inspection.id}`,
        });
      }
      // The contractor who lost the job needs to know as much as the one who
      // gained it — otherwise they keep working a record that is no longer
      // theirs, and their inbox silently drops it.
      if (previousAssignee) {
        await notificationService.notifyEvent({
          event_type: 'defect_unassigned',
          scope: previousAssignee.scope,
          message: `${recordLabel(inspection)} has been reassigned to another contractor — it is no longer in your inbox.`,
          urgency: 'Informational',
          // No ?defect= here on purpose: the record has just left this
          // contractor's inbox, so naming it would select something they can
          // no longer see.
          link: '/contractor-inbox',
        });
      }
    } else if (priority !== undefined) {
      // A re-prioritised job changes what the contractor should work on next.
      const assignee = await contractorRecipient(inspection.contractor_id);
      if (assignee) {
        await notificationService.notifyEvent({
          event_type: 'priority_changed',
          scope: assignee.scope,
          message: `${recordLabel(inspection)} is now ${inspection.priority} priority.`,
          // Urgency tracks the new priority rather than being Warning either way
          // (D.13) — a drop to Low is not a warning. Same conditional shape as
          // complaint_submitted above.
          urgency: ['Critical', 'High'].includes(inspection.priority)
            ? 'Warning'
            : 'Informational',
          link: `/contractor-inbox?defect=${inspection.id}`,
        });
      }
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
    const { closing_remark, actual_cost, endorser_role, endorser_id, waiver_note } = req.body;

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

    // G7 / R9 — the client asked for "a digital sign-off from the EM Services
    // inspector", so the second signature must be an inspector's. Notably this
    // stops the contractor who did the work from endorsing that it was done.
    if (endorser_role !== 'inspector') {
      return res.status(400).json({
        code: 'ENDORSER_MUST_BE_INSPECTOR',
        message: 'The endorsing signature must belong to an inspector.',
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
        code: 'SIGNATURE_REQUIRED',
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

    // UC-004 precondition: the work must be done before it can be endorsed.
    // 'Resolved' is accepted alongside 'Rectified' — both are post-work states.
    if (!['Rectified', 'Resolved'].includes(existing.status)) {
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: `Only a Rectified or Resolved inspection can be closed (this one is ${existing.status}).`,
      });
    }

    // UC-004 precondition, second half: the contractor finishing the work is
    // not enough — an inspector must have checked it. That check is the
    // /review action, which until now only wrote an audit row nobody consulted,
    // so a manager could endorse and close work no inspector had ever seen.
    // Deliberately not waivable, unlike G8 below.
    if (!(await inspectionModel.hasInspectorReview(req.params.id))) {
      return res.status(409).json({
        code: 'NOT_REVIEWED',
        message:
          'An inspector must mark this record as reviewed before it can be closed.',
      });
    }

    // The endorser must be a real user (signatures.signer_id FK) whose stored
    // role actually matches the role being attributed to their signature —
    // without this, a signature could record a role the signer doesn't hold.
    const endorser = await query('SELECT id, role FROM users WHERE id = $1', [endorser_id]);
    if (endorser.rows.length === 0) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Endorser user not found.' });
    }
    if (endorser.rows[0].role !== endorser_role) {
      return res.status(400).json({
        code: 'ENDORSER_MUST_BE_INSPECTOR',
        message: 'The nominated endorser is not an inspector.',
      });
    }

    // G8: every defect must be rectified with the contractor's proof photo
    // before the record can be jointly endorsed. A manager who needs to close
    // regardless supplies `waiver_note` (>= 10 chars), which is recorded in the
    // closing remark so the exception is visible in the audit trail.
    const outstanding = await inspectionModel.findUnrectifiedDefects(req.params.id);
    const waiver = typeof waiver_note === 'string' ? waiver_note.trim() : '';
    if (outstanding.length > 0 && waiver.length < 10) {
      const items = outstanding.map((d) => d.display_order).join(', ');
      return res.status(409).json({
        code: 'UNRECTIFIED_DEFECTS',
        message: `Item(s) ${items} are not rectified with a completion photo. Provide a waiver note of at least 10 characters to close anyway.`,
      });
    }

    // Store both signatures in Cloudinary (/signatures folder). Every rejection
    // above happens first, so a failed close never leaves orphaned uploads.
    const [managerUrl, endorserUrl] = await Promise.all([
      cloudinaryService.uploadImage(managerFile.buffer, 'signatures'),
      cloudinaryService.uploadImage(endorserFile.buffer, 'signatures'),
    ]);

    const inspection = await inspectionModel.closeInspection(
      req.params.id,
      {
        // A waived close records why, so the exception survives in the record.
        closing_remark:
          outstanding.length > 0
            ? `${closing_remark.trim()}\n\n[Waiver — item(s) ${outstanding
                .map((d) => d.display_order)
                .join(', ')} closed unrectified] ${waiver}`
            : closing_remark.trim(),
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

    // Close is the end of the record's life: managers file it, admins see the
    // cost land, and the person who raised it finds out it is done.
    await notificationService.notifyEvent({
      event_type: 'closed',
      scope: { type: 'managers' },
      message: `${recordLabel(inspection)} was jointly endorsed and closed.`,
      urgency: 'Informational',
      link: `/inspections/${inspection.id}`,
    });
    await notificationService.notifyEvent({
      event_type: 'closed',
      scope: { type: 'admins' },
      message: `${recordLabel(inspection)} closed${inspection.actual_cost ? ` — cost $${inspection.actual_cost}` : ''}.`,
      urgency: 'Informational',
      link: `/admin/costs`,
    });
    const closeOwner = originatorScope(inspection);
    if (closeOwner) {
      await notificationService.notifyEvent({
        event_type: 'closed',
        scope: closeOwner,
        message: `${recordLabel(inspection)} has been resolved and closed.`,
        urgency: 'Informational',
        // /my-reports takes no :id — see contractorController.notifyTransition.
        link: '/my-reports',
      });
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

// POST /api/inspections/:id/review — an inspector confirms they've looked
// over a Rectified record (read-only otherwise). Writes an audit row only —
// no status change, no accept/close authority; that stays with the manager's
// joint-close flow.
async function reviewInspection(req, res, next) {
  try {
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';

    const result = await inspectionModel.markReviewed(
      req.params.id,
      note || null,
      req.user.id
    );
    if (!result) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Inspection not found.' });
    }
    if (result === 'INVALID_STATE') {
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: 'Only a Rectified record can be marked as reviewed.',
      });
    }

    res.json({ code: 'OK', message: 'Marked as reviewed.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/inspections/:id/reject — the manager refuses a contractor's
// rectification (UC-004 Alt 4). The record returns to 'Assigned' with a fresh
// 14-day deadline and an incremented reopen_count; prior signatures are kept
// (G20). Separate from PATCH /:id because it carries its own precondition and
// side effects.
async function rejectRectification(req, res, next) {
  try {
    const reason = (req.body.reason ?? '').trim();
    if (reason.length < 10) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Rejection reason must be at least 10 characters.',
      });
    }

    const inspection = await inspectionModel.rejectRectification(
      req.params.id,
      reason,
      req.user.id
    );
    if (!inspection) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Inspection not found.' });
    }
    if (inspection === 'INVALID_STATE') {
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: 'Only a Rectified record can have its rectification rejected.',
      });
    }

    // Resolved before the push so the contractor's room can be included in it;
    // the durable notification further down reuses the same lookup.
    const rejectAssignee = await contractorRecipient(inspection.contractor_id);

    // Live push — best-effort, never fails the rejection (G13). D.5 — the
    // contractor's own room is included, so their inbox stops showing the work
    // as accepted the moment it is sent back rather than on the next reload.
    // Keyed by the account holder's users.id, not the contractors row id.
    try {
      const rooms = ['manager-room', `block-${inspection.location_block}`];
      if (rejectAssignee) {
        rooms.push(...rejectAssignee.scope.rooms);
      }
      socketService.emitToRooms(rooms, 'status_update', {
        id: inspection.id,
        status: inspection.status,
        updated_at: inspection.updated_at,
      });
    } catch {
      // Socket not initialised (e.g. tests) — ignore.
    }

    // D.4 — re-fire the UC-014 email with email_type 'rejection' so the
    // contractor is told by mail, not just in-app, that the work came back with
    // a fresh deadline. Same policy as the assign path and the socket push: a
    // mail failure must never fail the rejection (G13).
    if (inspection.contractor_id) {
      try {
        const { rows } = await query(CONTRACTOR_RECIPIENT_SQL, [inspection.contractor_id]);
        const recipients = [rows[0]?.contact_email];
        if (config.DEFECT_ALERT_RECIPIENTS) {
          recipients.push(config.DEFECT_ALERT_RECIPIENTS);
        }
        const to = recipients.filter(Boolean).join(',');
        if (to) {
          await emailService.sendDefectAlert(inspection, to, {
            email_type: 'rejection',
            reason,
          });
        }
      } catch (err) {
        console.error('[inspectionController] Rejection email failed:', err.message);
      }
    }

    // The contractor has to redo the work, so they are the one party who must
    // see the reason. The status_update above now reaches their room too, but
    // this is the durable copy — it survives them being offline.
    if (rejectAssignee) {
      await notificationService.notifyEvent({
        event_type: 'rectification_rejected',
        scope: rejectAssignee.scope,
        message: `Rectification rejected on ${recordLabel(inspection)} — ${reason}`,
        urgency: 'Warning',
        link: `/contractor-inbox?defect=${inspection.id}`,
      });
    }

    res.json(inspection);
  } catch (err) {
    next(err);
  }
}

// GET /api/inspections/overdue-chase — daily cron-guarded job (D.7). Reminds the
// contractor about defects due in 3 days or already past their deadline, and
// tells the managers who have to escalate.
//
// Scope and exclusions live in defectEmailModel.findDueForChase: Assigned /
// Acknowledged only (a Rectified record is waiting on the manager, not the
// contractor) and On Hold excluded, because a hold pauses the rectification clock
// (G11) and the dashboard's overdue count excludes it too — chasing a held record
// would make the emails contradict the UI.
//
// Idempotent per record per day: a record already chased today is skipped, so a
// re-run or a manual workflow_dispatch sends nothing twice. One record's failure
// never stops the rest of the run.
async function overdueChase(req, res, next) {
  try {
    const due = await defectEmailModel.findDueForChase();

    const chased = [];
    const skipped = [];

    for (const record of due) {
      const days = Number(record.days_remaining);

      try {
        if (await defectEmailModel.sentToday(record.id, 'overdue_chase')) {
          skipped.push({ id: record.id, reason: 'already_chased_today' });
          continue;
        }

        const outcome = await deliverDefectEmail(record, {
          email_type: 'overdue_chase',
          contact_email: record.contact_email,
          lift_code: record.lift_code,
          days_remaining: days,
          auditAction: 'Overdue Reminder Sent',
        });

        if (outcome !== 'sent') {
          skipped.push({ id: record.id, reason: outcome });
          continue;
        }

        chased.push({
          id: record.id,
          title: record.title,
          contractor: record.contractor_name,
          days_remaining: days,
        });

        // Durable notifications alongside the mail: the manager escalates, and
        // the contractor sees it in the portal even if the email is missed.
        const label = days < 0
          ? `${Math.abs(days)} day(s) overdue`
          : `due in ${days} day(s)`;
        await notificationService.notifyEvent({
          event_type: 'overdue_chase',
          scope: { type: 'managers' },
          message: `${recordLabel(record)} is ${label} — ${record.contractor_name} reminded.`,
          urgency: days < 0 ? 'Critical' : 'Warning',
          link: `/inspections/${record.id}`,
        });
        if (record.contractor_user_id) {
          await notificationService.notifyEvent({
            event_type: 'overdue_chase',
            scope: {
              type: 'users',
              user_ids: [record.contractor_user_id],
              rooms: [`contractor-${record.contractor_user_id}`],
            },
            message: `${recordLabel(record)} is ${label}. Please rectify and submit your completion proof.`,
            urgency: days < 0 ? 'Critical' : 'Warning',
            link: `/contractor-inbox?defect=${record.id}`,
          });
        }
      } catch (err) {
        // One bad record must not abort the whole daily run.
        console.error(`[overdueChase] ${record.id} failed:`, err.message);
        skipped.push({ id: record.id, reason: 'error' });
      }
    }

    res.json({
      due: due.length,
      chased: chased.length,
      skipped: skipped.length,
      records: chased,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/inspections/defect-alert-demo — cron-guarded trigger used by the
// GitHub Actions demo workflow. Sends a fixed sample defect-assignment alert to
// everyone on DEFECT_ALERT_RECIPIENTS so the whole team receives the email live
// during the presentation. Not tied to a real record (no DB dependency).
async function defectAlertDemo(req, res, next) {
  try {
    const recipients = config.DEFECT_ALERT_RECIPIENTS;
    if (!recipients) {
      return res.status(400).json({
        code: 'NO_RECIPIENTS',
        message: 'Set DEFECT_ALERT_RECIPIENTS (comma-separated) before running the demo alert.',
      });
    }

    const sample = {
      title: 'Lift cabin door fault',
      category: 'Lift',
      priority: 'High',
      location_block: '44A',
      location_unit: null,
      description:
        'Cabin door on Lift 1 is stalling on close — flagged for urgent rectification (demo alert).',
      target_deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };

    await emailService.sendDefectAlert(sample, recipients);
    res.json({ sent: true, recipients });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  closeInspection,
  create,
  createLiftInspection,
  defectAlertDemo,
  getDetail,
  listForManager,
  listMine,
  listStatusBoard,
  ocrPrefill,
  overdueChase,
  rejectRectification,
  reviewInspection,
  updateInspection,
};
