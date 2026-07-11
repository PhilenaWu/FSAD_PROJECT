// Checklist item routes. Any authenticated user can read the template
// (inspectors need it to render the spot-check form).
'use strict';

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const checklistItemController = require('../controllers/checklistItemController');

const router = express.Router();

// GET /api/checklist-items — active template, sorted by display_order.
router.get('/', requireAuth, checklistItemController.list);

module.exports = router;
