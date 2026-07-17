// Contractor routes. Managers fetch the contractor list for assignment.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const contractorController = require('../controllers/contractorController');

const router = express.Router();

// GET /api/contractors — manager-only assignment dropdown source.
router.get('/', requireAuth, requireRole('manager'), contractorController.list);

module.exports = router;
