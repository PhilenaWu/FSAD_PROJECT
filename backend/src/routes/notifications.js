// Notification routes (UC-008). Managers send/schedule and read receipts;
// recipients mark read. Scheduled dispatch is server-side (notificationDispatcher.js),
// so there is no /dispatch route.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

// POST /api/notifications — manager sends or schedules a scoped notification.
router.post('/', requireAuth, requireRole('manager'), notificationController.send);

// GET /api/notifications/:id/receipts — manager polls read/unread counts.
router.get(
  '/:id/receipts',
  requireAuth,
  requireRole('manager'),
  notificationController.getReceipts
);

// PATCH /api/notifications/:id/read — any authenticated recipient marks it read.
router.patch('/:id/read', requireAuth, notificationController.markRead);

module.exports = router;
