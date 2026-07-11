// Inspection routes. UC-001: residents file complaints (with an optional photo);
// inspectors file lift spot-checks with checklist results.
'use strict';

const express = require('express');
const multer = require('multer');

const { requireAuth, requireRole } = require('../middleware/auth');
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

// POST /api/inspections — resident submits a complaint; `photo` is optional.
router.post(
  '/',
  requireAuth,
  requireRole('resident'),
  upload.single('photo'),
  inspectionController.create
);

// POST /api/inspections/lift — inspector submits a lift spot-check
// (multipart: lift_id + checklist JSON fields, plus optional per-defect-item
// photos as `photo_<checklist_item_id>` file parts).
router.post(
  '/lift',
  requireAuth,
  requireRole('inspector'),
  upload.any(),
  inspectionController.createLiftInspection
);

module.exports = router;
