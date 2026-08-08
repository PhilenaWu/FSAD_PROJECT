// Notification routes (UC-008). Managers send/schedule and read receipts;
// recipients mark read. Scheduled dispatch is server-side (notificationDispatcher.js),
// so there is no /dispatch route.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

// POST /api/notifications — manager sends or schedules a scoped notification;
// a contractor sends to the managers and inspectors (item 16b). Which scopes
// each role may address is enforced in the controller (SCOPES_FOR_SENDER) —
// the route only knows the role, not the audience being asked for.
router.post('/', requireAuth, requireRole('manager', 'contractor'), notificationController.send);

// GET /api/notifications — the caller's own persisted inbox (any role).
// Declared before /:id/receipts; the paths are distinct, so order is only for
// readability.
router.get('/', requireAuth, notificationController.listMine);

// GET /api/notifications/sent — the manager's own send history (UC-008).
// Declared before /:id/receipts so the literal path is never shadowed if that
// route is ever widened to a single segment.
router.get('/sent', requireAuth, requireRole('manager'), notificationController.listSent);

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
