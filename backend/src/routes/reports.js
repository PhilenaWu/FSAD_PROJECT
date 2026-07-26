// UC-009 automated report routes.
//   GET  /generate        — scheduled run (GitHub Actions cron); cron-secret only.
//   POST /generate-manual — manager-triggered run for a chosen range.
//   GET  /                — list past reports (archive), manager/admin only.
'use strict';

const express = require('express');

const { cronGuard } = require('../middleware/cronGuard');
const { requireAuth, requireRole } = require('../middleware/auth');
const reportController = require('../controllers/reportController');

const router = express.Router();

// GET /api/reports/generate — scheduled monthly run. Gated by the shared cron
// secret (no logged-in user); generates the previous calendar month's report.
router.get('/generate', cronGuard, reportController.generateScheduled);

// POST /api/reports/generate-manual — manager on-demand generation.
router.post(
  '/generate-manual',
  requireAuth,
  requireRole('manager'),
  reportController.generateManual
);

// GET /api/reports — archive list for managers/admins.
router.get('/', requireAuth, requireRole('manager', 'admin'), reportController.listReports);

module.exports = router;
