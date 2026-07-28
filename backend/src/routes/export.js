// Export routes (HLD §6.11). Manager for UC-005; admin included for the
// future UC-011 cost deck.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const exportController = require('../controllers/exportController');

const router = express.Router();

// POST /api/export/pptx — render the current dashboard into a PowerPoint deck.
router.post('/pptx', requireAuth, requireRole('manager', 'admin'), exportController.generatePptx);

// POST /api/export/admin-costs-pptx — UC-011 cost deck. Admin ONLY: cost figures
// are commercially sensitive, so a manager gets 403 here even though the UC-005
// deck above admits them.
router.post(
  '/admin-costs-pptx',
  requireAuth,
  requireRole('admin'),
  exportController.generateAdminCostsPptx
);

module.exports = router;
