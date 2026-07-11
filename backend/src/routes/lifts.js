// Lift routes. Inspectors fetch the lift list for the spot-check picker.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const liftController = require('../controllers/liftController');

const router = express.Router();

// GET /api/lifts — inspector-only lift list (with contractor names).
router.get('/', requireAuth, requireRole('inspector'), liftController.list);

module.exports = router;
