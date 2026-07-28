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
router.get(
  '/',
  requireAuth,
  requireRole('manager'),
  inspectionController.listForManager
);

// GET /api/inspections/:id — full record + audit history (manager detail view).
// Registered after the literal routes so /my and /status-board aren't captured.
router.get(
  '/:id',
  requireAuth,
  requireRole('manager'),
  inspectionController.getDetail
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

// POST /api/inspections/:id/close — manager closes a record (UC-004) with a
// remark + dual e-signature (manager_signature & endorser_signature PNGs) and
// optional actual_cost. Separate from PATCH /:id, which excludes 'Closed'.
router.post(
  '/:id/close',
  requireAuth,
  requireRole('manager'),
  upload.fields([
    { name: 'manager_signature', maxCount: 1 },
    { name: 'endorser_signature', maxCount: 1 },
  ]),
  inspectionController.closeInspection
);

module.exports = router;
