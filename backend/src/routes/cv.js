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

module.exports = router;
