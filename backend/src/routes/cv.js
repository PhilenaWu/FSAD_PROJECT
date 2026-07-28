// CV routes. detect() is called internally by inspectionController, not
// through this router.
'use strict';

const express = require('express');

const { cronGuard } = require('../middleware/cronGuard');
const { requireAuth, requireRole } = require('../middleware/auth');
const cvController = require('../controllers/cvController');

const router = express.Router();

// GET /api/cv/batch-scan — drains retry_queue (Roboflow rate-limit buffer).
router.get('/batch-scan', cronGuard, async (req, res, next) => {
  try {
    const result = await cvController.batchScan();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/cv/detections?status=low_confidence — manager's manual review queue.
router.get('/detections', requireAuth, requireRole('manager'), cvController.listDetections);

// POST /api/cv/detections/:id/create-ticket — manager confirms a low-confidence
// detection as real, choosing category/priority; creates a ticket.
router.post(
  '/detections/:id/create-ticket',
  requireAuth,
  requireRole('manager'),
  cvController.createTicketFromDetection
);

// POST /api/cv/detections/:id/dismiss — manager decides it's not a real defect.
router.post('/detections/:id/dismiss', requireAuth, requireRole('manager'), cvController.dismissDetection);

module.exports = router;
