// UC-003 routes — the originator's own reports. The list itself lives on
// GET /api/inspections/my; this is the detail view behind it.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const myReportsController = require('../controllers/myReportsController');

const router = express.Router();

// GET /api/my-reports/history — the caller's closed records. Registered above
// '/:id' so 'history' isn't captured as an id.
router.get(
  '/history',
  requireAuth,
  requireRole('resident', 'inspector'),
  myReportsController.listOwnHistory
);

// GET /api/my-reports/:id — full detail + audit history + checklist results for
// a record the caller filed, live or closed. Scoping happens in the controller.
router.get(
  '/:id',
  requireAuth,
  requireRole('resident', 'inspector'),
  myReportsController.getOwnDetail
);

// PATCH /api/my-reports/:id — resident edits their own complaint within 30
// minutes of filing it (title, description, category, location).
router.patch(
  '/:id',
  requireAuth,
  requireRole('resident'),
  myReportsController.updateOwnReport
);

module.exports = router;
