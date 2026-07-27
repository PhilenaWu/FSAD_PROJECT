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

// Persists a cv_detections row for a raw Roboflow result, and — once
// confidence clears the threshold — a separate cv_auto_detected inspections
// ticket linked back to it (per the HLD's one-to-one cv_detections →
// inspections relationship). No ticket is created without a location_block
// (inspections.location_block is NOT NULL) — the detection row is still kept.
// Shared by detect() and batchScan(). Returns { cvDetection, inspection }.
async function recordDetection({
  imageUrl, source, defect_class, confidence, bounding_box, location_block, location_unit,
}) {
  const clearsThreshold = confidence >= roboflowService.CONFIDENCE_THRESHOLD;
  const status = clearsThreshold ? 'processed' : 'low_confidence';

  const cvDetection = await cvDetectionModel.create({
    image_url: imageUrl,
    defect_class,
    confidence,
    bounding_box,
    source,
    status,
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

  return { cvDetection, inspection };
}

// Run Roboflow detection on an already-hosted image. context supplies the
// ticket's location and (when known) the inspection_id of the submission the
// photo came from — used to link a queued retry back to its origin.
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

      // Only look up the originating inspection when the detection actually
      // clears the threshold — below it, no ticket gets created, so there's
      // nothing to need a location for.
      let location_block;
      let location_unit;
      if (item.inspection_id && result.confidence >= roboflowService.CONFIDENCE_THRESHOLD) {
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

module.exports = { detect, batchScan, listDetections };
