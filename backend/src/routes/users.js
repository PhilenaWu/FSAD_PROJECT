// User routes. Exposes the caller's own profile for the app header.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const userController = require('../controllers/userController');

const router = express.Router();

// GET /api/users/me — any authenticated user may read their own profile row.
router.get('/me', requireAuth, userController.getMe);

// GET /api/users/inspectors — endorser candidates for the UC-004 close panel.
router.get(
  '/inspectors',
  requireAuth,
  requireRole('manager'),
  userController.listInspectors
);

module.exports = router;
