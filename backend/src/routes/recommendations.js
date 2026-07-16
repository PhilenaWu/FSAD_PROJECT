// AI recommendation routes (UC-005 list + UC-006 analysis/actions).
'use strict';

const express = require('express');

const config = require('../config/env');
const { requireAuth, requireRole } = require('../middleware/auth');
const recommendationController = require('../controllers/recommendationController');

const router = express.Router();

// Guard for GET /run: allow either a scheduled call carrying the CRON_SECRET as
// `Authorization: Bearer <CRON_SECRET>`, or an on-demand manager session. The
// cron path skips the Supabase check entirely; otherwise fall through to the
// normal requireAuth + requireRole('manager') chain.
function requireCronOrManager(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (config.CRON_SECRET && token && token === config.CRON_SECRET) {
    req.user = { id: null, role: 'cron' };
    return next();
  }

  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    return requireRole('manager')(req, res, next);
  });
}

// GET /api/recommendations — active AI risk alerts for the dashboard cards.
router.get('/', requireAuth, requireRole('manager'), recommendationController.listAlerts);

// GET /api/recommendations/run — nightly analysis (cron) or manager-triggered.
router.get('/run', requireCronOrManager, recommendationController.runAnalysis);

// POST /api/recommendations/:id/accept — manager accepts an alert.
router.post(
  '/:id/accept',
  requireAuth,
  requireRole('manager'),
  recommendationController.acceptAlert
);

// POST /api/recommendations/:id/dismiss — manager dismisses an alert.
router.post(
  '/:id/dismiss',
  requireAuth,
  requireRole('manager'),
  recommendationController.dismissAlert
);

module.exports = router;
