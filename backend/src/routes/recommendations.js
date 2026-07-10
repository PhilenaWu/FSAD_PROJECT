// AI recommendation routes. Only the manager-facing list endpoint exists so
// far (UC-005 dashboard). UC-006 adds: GET /run (cron), POST /:id/accept,
// POST /:id/dismiss (Davian).
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const recommendationController = require('../controllers/recommendationController');

const router = express.Router();

// GET /api/recommendations — active AI risk alerts for the dashboard cards.
router.get('/', requireAuth, requireRole('manager'), recommendationController.listAlerts);

module.exports = router;
