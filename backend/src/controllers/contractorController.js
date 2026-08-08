// Contractor controllers.
// - Managers list contractors to assign defects (UC-002): `list`.
// - Contractors work their assigned defects through the portal (UC-010):
//   `getAssigned`, `acknowledge`, `rectify`, `hold`.
'use strict';

const contractorModel = require('../models/contractorModel');
const inspectionModel = require('../models/inspectionModel');
const cloudinaryService = require('../services/cloudinaryService');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');

// GET /api/contractors — all contractors, for the manager assignment dropdown.
async function list(req, res, next) {
  try {
    const contractors = await contractorModel.findAll();
    res.json(contractors);
  } catch (err) {
    next(err);
  }
}

// Resolve the contractor record linked to the logged-in portal user. The
// portal is role-gated to `contractor`, but a login must also be linked to a
// contractor row (UC-012 onboarding does this) before it can see any defects.
// Returns the contractor row, or sends 403 and returns null.
async function resolveContractor(req, res) {
  const contractor = await contractorModel.findByUserId(req.user.id);
  if (!contractor) {
    res.status(403).json({
      code: 'FORBIDDEN',
      message: 'This account is not linked to a contractor.',
    });
    return null;
  }
  return contractor;
}

// Push a status change to the manager + originator rooms (UC-010 steps 3 & 8).
// Best-effort: a socket hiccup must never fail the HTTP action.
function emitStatus(inspection) {
  try {
    socketService.emitToRooms(
      ['manager-room', 'inspector-team', `block-${inspection.location_block}`],
      'status_update',
      { id: inspection.id, status: inspection.status, updated_at: inspection.updated_at }
    );
  } catch {
    // Socket not initialised (e.g. tests) — ignore.
  }
}

// The inspector who owns this record, and the room that reaches them. Returns
// null for a record with no inspector (a resident complaint not yet triaged).
//
// Contractor-side transitions go to managers + the inspector only (D.15) — the
// resident who filed the complaint is deliberately NOT notified from here.
// Previously this branched on resident_id first and emitted to `block-{n}`,
// which had two problems: that room holds *every* resident of the block, so a
// socket notification about one household's defect was pushed to all of their
// neighbours while only the originator got a durable row; and it meant a single
// contractor submit fanned out to two overlapping audiences (D.12). Residents
// still track their own reports on /my-reports, which reads live status.
function inspectorOf(inspection) {
  if (inspection.inspector_id) {
    return { user_ids: [inspection.inspector_id], rooms: ['inspector-team'] };
  }
  return null;
}

// Durable notification for a contractor-side transition. Separate from
// emitStatus: that pushes a transient refresh to whoever has a page open, while
// this persists to the bell so an offline manager or inspector still learns of
// it. Never throws (notifyEvent swallows its own failures, G13).
//
// One notification, one audience: managers + the record's inspector, resolved as
// a single `users` scope. It used to be two notifyEvent calls with two different
// wordings, which wrote two rows per transition — anyone who fell in both
// audiences saw the same event twice in the bell (D.12). Staff open the same
// record from the same link, so the second wording bought nothing.
async function notifyTransition(inspection, { event_type, message, urgency }) {
  const inspector = inspectorOf(inspection);

  await notificationService.notifyEvent({
    event_type,
    scope: { type: 'managers_and_users', user_ids: inspector?.user_ids ?? [], rooms: inspector?.rooms ?? [] },
    message,
    urgency,
    link: `/inspections/${inspection.id}`,
  });
}

// Contractor finishes -> the inspector gets a task, the managers get a notice
// (item 17). Two notifications on purpose, which is not a relapse into D.12:
// that was one event written twice to *overlapping* audiences, so a person in
// both saw it twice. These two audiences are disjoint by role — a manager is
// never an inspector — so nobody is notified twice, and each side reads what
// it actually has to do.
//
// The split exists because the endorsement close needs an inspector who has
// looked at the work (UC-004), and a line addressed to managers ("ready for
// joint endorsement") does not tell the inspector that anything is theirs.
//
// This is the trigger half of item 17 only. The destination — the inspector's
// review queue and POST /:id/review — already exists and belongs to UC-004, so
// inspectionController is not touched: the record enters that queue on its own
// when the status becomes Rectified ("Pending View By Inspector").
async function notifyRectified(inspection, contractor) {
  const link = `/inspections/${inspection.id}`;
  const label = recordLabel(inspection);

  // Informational, not Warning (D.13): a contractor finishing on time is the
  // happy path for the people who only need to know it happened.
  await notificationService.notifyEvent({
    event_type: 'rectified',
    scope: { type: 'managers' },
    message: `${contractor.name} submitted work done on ${label} — ready for joint endorsement.`,
    urgency: 'Informational',
    link,
  });

  // Every active inspector, not just the record's own. The review queue they
  // see is estate-wide — it lists every record awaiting a check, whoever filed
  // it — and any inspector's review satisfies the close gate. Addressing only
  // inspection.inspector_id meant a resident complaint assigned to a contractor
  // (no inspector on the record at all) appeared in that queue with nobody
  // told, which is most of what lands there.
  //
  // Warning rather than Informational, unlike the managers' copy: this one is a
  // job with the close waiting on it, which is exactly the "actually needs
  // action" test D.13 set for the label.
  await notificationService.notifyEvent({
    event_type: 'review_requested',
    scope: { type: 'inspector_team' },
    message: `${label} — ${contractor.name} has finished. Check the work before the manager closes it.`,
    urgency: 'Warning',
    link,
  });
}

// Human label for a record in a notification line.
function recordLabel(inspection) {
  return inspection.location_block
    ? `Blk ${inspection.location_block} — ${inspection.title}`
    : inspection.title;
}

// GET /api/contractor/assigned — the contractor's inbox: their assigned defects
// with a days-remaining countdown and the defect checklist items to rectify.
async function getAssigned(req, res, next) {
  try {
    const contractor = await resolveContractor(req, res);
    if (!contractor) return;
    const data = await inspectionModel.findAssignedToContractor(contractor.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// POST /api/contractor/:id/acknowledge — contractor accepts the defect.
async function acknowledge(req, res, next) {
  try {
    const contractor = await resolveContractor(req, res);
    if (!contractor) return;

    const inspection = await inspectionModel.acknowledgeByContractor(
      req.params.id,
      contractor.id,
      req.user.id
    );
    if (!inspection) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'This defect is no longer assigned to you.',
      });
    }
    emitStatus(inspection);
    await notifyTransition(inspection, {
      event_type: 'acknowledged',
      message: `${contractor.name} acknowledged ${recordLabel(inspection)}.`,
      urgency: 'Informational',
    });
    res.json({
      id: inspection.id,
      status: inspection.status,
      acknowledged_at: inspection.acknowledged_at,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/contractor/:id/rectify — contractor records rectification work
// (multipart): per-item completion remarks + `rectified` flags in an `items`
// JSON field, per-item completion photos as `photo_<checklist_result_id>` file
// parts, an optional `remark` (audit note), and a `finalize` flag. When
// finalize is true (the default) a `signature` PNG is required and the record
// moves to Rectified; a partial save (finalize=false) just records progress and
// needs no signature (UC-010 Alt Flow B).
async function rectify(req, res, next) {
  try {
    const contractor = await resolveContractor(req, res);
    if (!contractor) return;

    // Default true so the original single-shot completion keeps working.
    const finalize = req.body.finalize !== 'false' && req.body.finalize !== false;

    // The e-signature is mandatory only when finalizing (UC-010 E2).
    const signatureFile = (req.files ?? []).find((f) => f.fieldname === 'signature');
    if (finalize && !signatureFile) {
      return res.status(400).json({
        code: 'SIGNATURE_REQUIRED',
        message: 'Signature not captured — please sign again.',
      });
    }

    // Completion remarks/flags arrive as a JSON string alongside the file parts.
    let items = [];
    if (req.body.items) {
      try {
        items = JSON.parse(req.body.items);
      } catch {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'items must be a valid JSON array.',
        });
      }
    }

    // Per-item completion photos: file parts named photo_<checklist_result_id>.
    // Upload to Cloudinary (/defects) and attach the URL to the matching item.
    const byResultId = new Map(items.map((it) => [it.checklist_result_id, it]));
    for (const file of req.files ?? []) {
      const match = /^photo_(.+)$/.exec(file.fieldname);
      if (!match) continue;
      const item = byResultId.get(match[1]);
      if (item) {
        item.completion_photo_url = await cloudinaryService.uploadImage(file.buffer, 'defects');
      }
    }

    // Only upload/store the signature on a finalizing submit.
    const signatureUrl = finalize
      ? await cloudinaryService.uploadImage(signatureFile.buffer, 'signatures')
      : undefined;

    const inspection = await inspectionModel.rectifyByContractor(
      req.params.id,
      contractor.id,
      req.user.id,
      { items, signatureUrl, note: req.body.remark, finalize }
    );
    if (!inspection) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'This defect is no longer assigned to you.',
      });
    }
    emitStatus(inspection);
    // Only a finalizing submit notifies. A partial save ('Work Progress Saved')
    // stays socket-only — HLD §10 gives it no email, and a durable row per save
    // would bury the bell under progress noise.
    if (finalize) {
      await notifyRectified(inspection, contractor);
    }
    res.json({
      id: inspection.id,
      status: inspection.status,
      rectified_at: inspection.rectified_at,
      finalized: finalize,
      signature_stored: finalize,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/contractor/:id/hold — contractor cannot rectify yet (access denied,
// part on order, out of scope). Records a reason and pauses the deadline.
async function hold(req, res, next) {
  try {
    const contractor = await resolveContractor(req, res);
    if (!contractor) return;

    const { hold_reason } = req.body;
    if (!hold_reason || !hold_reason.trim()) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'hold_reason is required.',
      });
    }

    const inspection = await inspectionModel.holdByContractor(
      req.params.id,
      contractor.id,
      req.user.id,
      hold_reason.trim()
    );
    if (!inspection) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'This defect is no longer assigned to you.',
      });
    }
    emitStatus(inspection);
    // Stays Warning — a hold blocks the work and someone has to unblock it.
    await notifyTransition(inspection, {
      event_type: 'on_hold',
      message:
        `${contractor.name} placed ${recordLabel(inspection)} on hold — ${inspection.hold_reason}`,
      urgency: 'Warning',
    });
    res.json({
      id: inspection.id,
      status: inspection.status,
      hold_reason: inspection.hold_reason,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/contractor/:id/resume — the blocker is cleared and work can carry
// on (UC-010 Alt Flow A, second half). Restores the pre-hold status and pushes
// target_deadline out by the held duration, so a contractor is not marked late
// for time they spent waiting on access or a part (G11).
async function resume(req, res, next) {
  try {
    const contractor = await resolveContractor(req, res);
    if (!contractor) return;

    const inspection = await inspectionModel.resumeByContractor(
      req.params.id,
      contractor.id,
      req.user.id
    );
    if (!inspection) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'This defect is no longer assigned to you.',
      });
    }
    if (inspection === 'INVALID_STATE') {
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: 'Only a record that is On Hold can be resumed.',
      });
    }

    emitStatus(inspection);
    await notifyTransition(inspection, {
      event_type: 'resumed',
      message:
        `${contractor.name} resumed work on ${recordLabel(inspection)} — deadline extended by the held period.`,
      urgency: 'Informational',
    });
    res.json({
      id: inspection.id,
      status: inspection.status,
      hold_reason: inspection.hold_reason,
      target_deadline: inspection.target_deadline,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getAssigned, acknowledge, rectify, hold, resume };
