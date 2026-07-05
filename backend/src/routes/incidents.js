// Incident routes. UC-001: residents create incidents (with an optional photo).
'use strict';

const express = require('express');
const multer = require('multer');

const { requireAuth, requireRole } = require('../middleware/auth');
const incidentController = require('../controllers/incidentController');

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

// POST /api/incidents — resident submits an incident; `photo` is optional.
router.post(
  '/',
  requireAuth,
  requireRole('resident'),
  upload.single('photo'),
  incidentController.create
);

module.exports = router;
