// Export routes (HLD §6.11). Manager for UC-005; admin included for the
// future UC-011 cost deck.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const exportController = require('../controllers/exportController');

const router = express.Router();

// POST /api/export/pptx — render the current dashboard into a PowerPoint deck.
router.post('/pptx', requireAuth, requireRole('manager', 'admin'), exportController.generatePptx);

module.exports = router;
