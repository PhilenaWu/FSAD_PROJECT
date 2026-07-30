// Contractor portal routes (UC-010). A logged-in contractor works the defects
// assigned to them: view the inbox, acknowledge, submit rectification work with
// a completion photo + e-signature, or place a defect on hold and resume it. All routes are
// gated to the `contractor` role; ownership (the record is assigned to *this*
// contractor) is enforced in the model.
//
// Note: this is the singular `/api/contractor` portal (HLD §6.9), distinct from
// the plural `/api/contractors` manager assignment dropdown (routes/contractors.js).
'use strict';

const express = require('express');
const multer = require('multer');

const { requireAuth, requireRole } = require('../middleware/auth');
const contractorController = require('../controllers/contractorController');

const router = express.Router();

// Completion photos + the signature PNG are held in memory for Cloudinary.
// Same caps/filter as the inspection uploads; upload.any() accepts the dynamic
// photo_<checklist_result_id> field names plus `signature`.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 }, // 5 MB each, ≤20 files
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

// GET /api/contractor/assigned — the contractor's assigned-defects inbox.
router.get('/assigned', requireAuth, requireRole('contractor'), contractorController.getAssigned);

// POST /api/contractor/:id/acknowledge — accept a defect.
router.post(
  '/:id/acknowledge',
  requireAuth,
  requireRole('contractor'),
  contractorController.acknowledge
);

// POST /api/contractor/:id/rectify — submit completion photos/remarks + e-sign.
router.post(
  '/:id/rectify',
  requireAuth,
  requireRole('contractor'),
  upload.any(),
  contractorController.rectify
);

// POST /api/contractor/:id/hold — mark On Hold with a reason (Alt Flow A).
router.post('/:id/hold', requireAuth, requireRole('contractor'), contractorController.hold);

// POST /api/contractor/:id/resume — clear the hold and restart the clock,
// extending target_deadline by the held duration (Alt Flow A, G11). Without this
// an On Hold record had no way back and the pause was permanent.
router.post('/:id/resume', requireAuth, requireRole('contractor'), contractorController.resume);

module.exports = router;
