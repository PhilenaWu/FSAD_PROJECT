// Inspection routes. UC-001: residents file complaints (with an optional photo);
// inspectors file lift spot-checks with checklist results.
'use strict';

const express = require('express');
const multer = require('multer');

const { requireAuth, requireRole } = require('../middleware/auth');
const { cronGuard } = require('../middleware/cronGuard');
const inspectionController = require('../controllers/inspectionController');

const router = express.Router();

// Keep uploaded photos in memory so we can hand the buffers straight to
// Cloudinary. Cap size/count and accept images only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 }, // 5 MB each, ≤20 files
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

// G4 / R14 ("limit to 100k per photo"): photos are compressed to ≤100 KB
// client-side (utils/imageCompress); the server enforces the same ceiling so a
// client that skips compression can't fill storage. One photo per checklist
// item (25) plus the inspector's G5 signature part, hence 26. Over-size parts
// surface as PHOTO_TOO_LARGE via the error handler. The close route keeps the
// `upload` instance above — its signatures are not photos, and the 100 KB rule
// is about photo storage (the pad emits ~5-15 KB, well inside this cap).
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024, files: 26 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

// GET /api/inspections/defect-alert-demo — cron-guarded demo trigger (GitHub
// Actions). Emails a sample defect alert to DEFECT_ALERT_RECIPIENTS. Keep above
// '/:id' so 'defect-alert-demo' isn't captured as an id.
router.get('/defect-alert-demo', cronGuard, inspectionController.defectAlertDemo);

// GET /api/inspections/overdue-chase — daily cron-guarded chase (D.7). Reminds
// contractors at D−3 and from D+0 onward, skipping On Hold records and anything
// already chased today. Keep above '/:id'.
router.get('/overdue-chase', cronGuard, inspectionController.overdueChase);

// GET /api/inspections/status-board — privacy-safe estate-wide feed; any
// authenticated user. Keep above any future '/:id' route.
router.get('/status-board', requireAuth, inspectionController.listStatusBoard);

// GET /api/inspections/my — the caller's own reports (resident or inspector).
// Keep above any future '/:id' route so 'my' isn't captured as an id.
router.get(
  '/my',
  requireAuth,
  requireRole('resident', 'inspector'),
  inspectionController.listMine
);

// POST /api/inspections — resident submits a complaint; `photo` is optional.
router.post(
  '/',
  requireAuth,
  requireRole('resident'),
  uploadPhoto.single('photo'),
  inspectionController.create
);

// POST /api/inspections/ocr-prefill — UC-013: inspector scans a completed
// paper form; returns a draft only (G18), never written to the DB. Uses the
// 5 MB `upload` instance, not `uploadPhoto`'s 100 KB cap — a full-page form
// scan needs far more resolution than a defect thumbnail to stay legible for
// OCR. Keep above '/lift' — no route param clash, but grouped with the other
// inspector-only lift-form endpoints.
router.post(
  '/ocr-prefill',
  requireAuth,
  requireRole('inspector'),
  upload.single('form_photo'),
  inspectionController.ocrPrefill
);

// POST /api/inspections/lift — inspector submits a lift spot-check
// (multipart: lift_id + checklist JSON fields, plus optional per-defect-item
// photos as `photo_<checklist_item_id>` file parts).
router.post(
  '/lift',
  requireAuth,
  requireRole('inspector'),
  uploadPhoto.any(),
  inspectionController.createLiftInspection
);

// GET /api/inspections — manager triage queue with ?status=&category=&block=.
// `status` accepts a comma-separated list, so the queue's status-group tabs
// ("Needs action" = Open,Pending Assignment) are one request. `?archived=true`
// returns closed records instead — the history view.
// Inspectors may also read this (read-only): they use it filtered to
// status=Rectified to review completed work before the manager's joint close.
router.get(
  '/',
  requireAuth,
  requireRole('manager', 'inspector'),
  inspectionController.listForManager
);

// GET /api/inspections/:id — full record + audit history (manager detail view).
// Inspectors may also read this (read-only, see above). Registered after the
// literal routes so /my and /status-board aren't captured.
router.get(
  '/:id',
  requireAuth,
  requireRole('manager', 'inspector'),
  inspectionController.getDetail
);

// GET /api/inspections/:id/translation?lang=en|zh|ms|ta — the record's title/
// description translated for a viewer whose preferred_language differs from
// the resident's. On-demand and cached; never called automatically by the
// list or detail views. Same audience as GET /:id.
router.get(
  '/:id/translation',
  requireAuth,
  requireRole('manager', 'inspector'),
  inspectionController.getTranslation
);

// PATCH /api/inspections/:id — manager triage (UC-002): priority, status,
// contractor assignment, deadline. Registered after /my and /status-board so
// those aren't captured as :id.
router.patch(
  '/:id',
  requireAuth,
  requireRole('manager'),
  inspectionController.updateInspection
);

// POST /api/inspections/:id/review — inspector marks a Rectified record as
// reviewed (read-only otherwise): audit-trail entry only, no status change.
router.post(
  '/:id/review',
  requireAuth,
  requireRole('inspector'),
  inspectionController.reviewInspection
);

// POST /api/inspections/:id/reject — manager refuses a rectification (UC-004
// Alt 4): back to 'Assigned' with a fresh deadline and a reason. JSON body.
router.post(
  '/:id/reject',
  requireAuth,
  requireRole('manager'),
  inspectionController.rejectRectification
);

// POST /api/inspections/:id/close — manager closes a record (UC-004) with a
// remark + the manager's own signature (manager_signature PNG) and optional
// actual_cost. Separate from PATCH /:id, which excludes 'Closed'.
router.post(
  '/:id/close',
  requireAuth,
  requireRole('manager'),
  upload.fields([{ name: 'manager_signature', maxCount: 1 }]),
  inspectionController.closeInspection
);

module.exports = router;
