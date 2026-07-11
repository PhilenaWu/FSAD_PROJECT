// Inspection routes. UC-001: residents file complaints (with an optional photo);
// inspectors file lift spot-checks with checklist results.
'use strict';

const express = require('express');
const multer = require('multer');

const { requireAuth, requireRole } = require('../middleware/auth');
const inspectionController = require('../controllers/inspectionController');

const router = express.Router();

// Keep the uploaded photo in memory so we can hand the buffer straight to
// Cloudinary. Cap size and accept images only.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

// POST /api/inspections — resident submits a complaint; `photo` is optional.
router.post(
  '/',
  requireAuth,
  requireRole('resident'),
  upload.single('photo'),
  inspectionController.create
);

// POST /api/inspections/lift — inspector submits a lift spot-check (JSON, no
// photo upload in this flow).
router.post(
  '/lift',
  requireAuth,
  requireRole('inspector'),
  inspectionController.createLiftInspection
);

module.exports = router;
