// CV pipeline controller (UC-007). detect() is called internally (not as its
// own HTTP route), asynchronously, by inspectionController right after a
// photo is uploaded to Cloudinary. batchScan() drains retry_queue and is
// exposed as GET /api/cv/batch-scan (cron-gated).
'use strict';

const roboflowService = require('../services/roboflowService');
const cvDetectionModel = require('../models/cvDetectionModel');
const inspectionModel = require('../models/inspectionModel');
const retryQueueModel = require('../models/retryQueueModel');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const { priorityFromScore } = require('../utils/priorityFromScore');

// A photo that came with a real human report (resident/inspector upload —
// originatingInspectionId is known) blends its CV confidence into that
// report's priority instead of spawning a separate ticket: one real-world
// defect, one ticket. Priority is the average of the human-derived score
// (ai_priority_score, from openaiService's categorisation of the complaint
// text) and a CV-derived score (confidence, 0-1, scaled to the same 0-100
// range), mapped to the priority label via priorityFromScore(). Runs
// regardless of the 70% ticket-creation threshold — that threshold is about
// whether to trust a detection enough to act on it alone, not about whether
// the photo evidence should inform an already-real report's priority.
// cvDetectionId links the report to its detection (bounding_box, defect_class,
// confidence) so the frontend's BoundingBoxOverlay has something to fetch —
// without it, a blended report's priority changes but the photo shows no
// overlay, since findDetailById() only joins cv_detections via this column.
// Returns the updated inspection, or null if it no longer exists.
async function blendPriorityIntoInspection(inspectionId, confidence, cvDetectionId) {
  const inspection = await inspectionModel.findById(inspectionId);
  if (!inspection) return null;

  const humanScore = inspection.ai_priority_score ?? 50;
  const cvScore = Math.round(confidence * 100);
  const blendedScore = Math.round((humanScore + cvScore) / 2);
  const priority = priorityFromScore(blendedScore);

  const updated = await inspectionModel.updatePriority(inspectionId, {
    priority,
    ai_priority_score: blendedScore,
    cv_detection_id: cvDetectionId,
  });
  if (!updated) return null;

  // Real-time push; a socket hiccup must never fail the CV pipeline (mirrors
  // inspectionController's own status_update emit — same event, same rooms —
  // since this is a priority change on an existing record, not a new ticket).
  try {
    socketService.emitToRooms(
      ['manager-room', `block-${updated.location_block}`],
      'status_update',
      { id: updated.id, status: updated.status, priority: updated.priority, updated_at: updated.updated_at }
    );
  } catch {
    // Socket not initialised (e.g. tests) or emit failed — ignore.
  }

  return updated;
}

// Persists a cv_detections row for a raw Roboflow result. What happens next
// depends on whether the photo has an originating report:
//  - originatingInspectionId set (resident/inspector upload) → blend the CV
//    confidence into that report's priority (see blendPriorityIntoInspection);
//    no separate ticket, since it'd duplicate the same defect.
//  - no originating report (e.g. a scheduled scan of common areas) → once
//    confidence clears the threshold, create a standalone cv_auto_detected
//    ticket linked back to the detection (the HLD's one-to-one cv_detections
//    → inspections relationship). No ticket without a location_block
//    (inspections.location_block is NOT NULL) — the detection row is kept.
// Shared by detect() and batchScan(). Returns { cvDetection, inspection }.
async function recordDetection({
  imageUrl, source, defect_class, confidence, bounding_box,
  location_block, location_unit, originatingInspectionId,
}) {
  if (originatingInspectionId) {
    const cvDetection = await cvDetectionModel.create({
      image_url: imageUrl,
      defect_class,
      confidence,
      bounding_box,
      source,
      status: 'processed', // handled via blend, not the review queue
      location_block,
      location_unit,
    });
    const inspection = await blendPriorityIntoInspection(originatingInspectionId, confidence, cvDetection.id);
    return { cvDetection, inspection };
  }

  const clearsThreshold = confidence >= roboflowService.CONFIDENCE_THRESHOLD;
  const status = clearsThreshold ? 'processed' : 'low_confidence';

  const cvDetection = await cvDetectionModel.create({
    image_url: imageUrl,
    defect_class,
    confidence,
    bounding_box,
    source,
    status,
    location_block,
    location_unit,
  });

  if (!clearsThreshold || !location_block) {
    return { cvDetection, inspection: null };
  }

  const inspection = await inspectionModel.create({
    source_type: 'cv_auto_detected',
    title: `Auto-detected: ${defect_class}`,
    description: `CV detected a ${defect_class} defect at ${Math.round(confidence * 100)}% confidence.`,
    location_block,
    location_unit,
    photo_url: imageUrl,
    source_flag: 'Auto-Detected',
    cv_detection_id: cvDetection.id,
  });

  // Real-time push; a socket hiccup must never fail the CV pipeline (mirrors
  // inspectionController's status_update emit — same try/catch, same rooms).
  try {
    socketService.emitToRooms(['manager-room', `block-${location_block}`], 'cv_alert', {
      id: inspection.id,
      defect_class,
      confidence,
      location_block,
      photo_url: imageUrl,
      created_at: inspection.created_at,
    });
  } catch {
    // Socket not initialised (e.g. tests) or emit failed — ignore.
  }

  // The cv_alert event above has no listener anywhere in the frontend, so a
  // high-confidence detection reached nobody. CV is assistive and a human must
  // confirm it, which requires the human to know it exists.
  await notificationService.notifyEvent({
    event_type: 'cv_detection',
    scope: { type: 'managers' },
    message: `CV detected a ${defect_class} defect at Blk ${location_block} (${Math.round(confidence * 100)}% confidence) — needs confirmation.`,
    urgency: 'Warning',
    link: `/inspections/${inspection.id}`,
  });

  return { cvDetection, inspection };
}

// Run Roboflow detection on an already-hosted image. context supplies the
// ticket's location and (when known) the inspection_id of the submission the
// photo came from — used both to link a queued retry back to its origin, and
// to blend the result into that report's priority (see recordDetection).
// On a 429 (rate limit), the image is queued to retry_queue instead of
// failing outright, and the manager is not notified yet (CV-T03).
// Returns { cvDetection, inspection, queued? }.
async function detect(imageUrl, source, context = {}) {
  let result;
  try {
    result = await roboflowService.detectDefect(imageUrl);
  } catch (err) {
    if (err.status === 429) {
      await retryQueueModel.create({ image_url: imageUrl, inspection_id: context.inspection_id });
      return { cvDetection: null, inspection: null, queued: true };
    }
    throw err;
  }

  return recordDetection({
    imageUrl,
    source,
    ...result,
    location_block: context.location_block,
    location_unit: context.location_unit,
    originatingInspectionId: context.inspection_id,
  });
}

// GET /api/cv/batch-scan (cron-gated) — retries retry_queue rows whose
// backoff window has elapsed. source is inferred from whether the row is
// linked to an originating inspection (resident/inspector upload) or not
// (scheduled_scan) — retry_queue has no source column of its own. A 429
// again reschedules with backoff; any other failure marks the row failed.
async function batchScan() {
  const pending = await retryQueueModel.findPending();
  let processed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const result = await roboflowService.detectDefect(item.image_url);

      // Look up the originating inspection's location whenever known, even
      // below the threshold — a low-confidence result still gets saved with
      // its location so a manager can turn it into a ticket later.
      let location_block;
      let location_unit;
      if (item.inspection_id) {
        const originating = await inspectionModel.findById(item.inspection_id);
        location_block = originating?.location_block;
        location_unit = originating?.location_unit;
      }

      await recordDetection({
        imageUrl: item.image_url,
        source: item.inspection_id ? 'resident_upload' : 'scheduled_scan',
        ...result,
        location_block,
        location_unit,
        originatingInspectionId: item.inspection_id,
      });

      await retryQueueModel.markProcessed(item.id);
      processed += 1;
    } catch (err) {
      if (err.status === 429) {
        await retryQueueModel.reschedule(item.id);
      } else {
        await retryQueueModel.markFailed(item.id);
        failed += 1;
      }
    }
  }

  const remaining = await retryQueueModel.countPending();
  return { processed, failed, remaining };
}

// GET /api/cv/detections?status=low_confidence — manager's manual review
// queue (task 4.8). Defaults to low_confidence since that's the review-queue
// use case; other statuses are accepted for completeness.
async function listDetections(req, res, next) {
  try {
    const status = req.query.status || 'low_confidence';
    const rows = await cvDetectionModel.findByStatus(status);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

// POST /api/cv/detections/:id/create-ticket — a manager reviewed a
// low-confidence detection and confirmed it's a real defect, choosing its
// category/priority. location falls back to whatever was captured with the
// detection; the manager can override it (a scheduled_scan detection has none
// stored). Marks the detection 'processed' so it leaves the review queue.
async function createTicketFromDetection(req, res, next) {
  try {
    const detection = await cvDetectionModel.findById(req.params.id);
    if (!detection) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Detection not found.' });
    }
    if (detection.status !== 'low_confidence') {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Only a low_confidence detection can be turned into a ticket.',
      });
    }

    const { category, priority, location_block, location_unit } = req.body;
    const block = location_block || detection.location_block;
    if (!category || !priority || !block) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'category, priority, and location_block are required.',
      });
    }

    const inspection = await inspectionModel.create({
      source_type: 'cv_auto_detected',
      title: `Auto-detected: ${detection.defect_class ?? 'unclassified'}`,
      description: `CV detected a ${detection.defect_class ?? 'unclassified'} defect at ${Math.round(
        Number(detection.confidence) * 100
      )}% confidence. Reviewed and ticketed by a manager.`,
      location_block: block,
      location_unit: location_unit || detection.location_unit,
      photo_url: detection.image_url,
      category,
      priority,
      source_flag: 'Auto-Detected',
      cv_detection_id: detection.id,
    });

    await cvDetectionModel.updateStatus(detection.id, 'processed');

    res.status(201).json(inspection);
  } catch (err) {
    next(err);
  }
}

// POST /api/cv/detections/:id/dismiss — a manager reviewed a low-confidence
// detection and decided it isn't a real defect. No ticket is created.
async function dismissDetection(req, res, next) {
  try {
    const detection = await cvDetectionModel.findById(req.params.id);
    if (!detection) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Detection not found.' });
    }
    if (detection.status !== 'low_confidence') {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Only a low_confidence detection can be dismissed.',
      });
    }

    const updated = await cvDetectionModel.updateStatus(detection.id, 'dismissed');
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  detect,
  batchScan,
  listDetections,
  createTicketFromDetection,
  dismissDetection,
};
