// User routes. The caller's own profile for the app header, resident
// self-registration, and the manager approval queue.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const { registerLimiter } = require('../middleware/rateLimiter');
const userController = require('../controllers/userController');

const router = express.Router();

// GET /api/users/me — any authenticated user may read their own profile row.
router.get('/me', requireAuth, userController.getMe);

// POST /api/users/register-profile — resident self-registration. requireAuth
// still applies: the caller must hold the Supabase session they just created,
// which is what pins the new row to their own auth id. Their profile row does
// not exist yet, so requireAuth's status gates pass through.
router.post(
  '/register-profile',
  registerLimiter,
  requireAuth,
  userController.registerProfile
);

// Manager approval queue for resident registrations.
router.get(
  '/pending-residents',
  requireAuth,
  requireRole('manager'),
  userController.listPendingResidents
);

router.post(
  '/pending-residents/:id/approve',
  requireAuth,
  requireRole('manager'),
  userController.approveResident
);

router.post(
  '/pending-residents/:id/reject',
  requireAuth,
  requireRole('manager'),
  userController.rejectResident
);

// GET /api/users/inspectors — endorser candidates for the UC-004 close panel.
router.get(
  '/inspectors',
  requireAuth,
  requireRole('manager'),
  userController.listInspectors
);

// GET /api/users/contacts — the help/contacts block for the caller's role: a
// manager gets the admins; an admin, an inspector and a contractor get the
// managers (item 16 added the contractor, who escalates to the manager who
// assigned the defect). Residents stay out: they reach the managing office
// through contact_directory, never an individual member of staff.
router.get(
  '/contacts',
  requireAuth,
  requireRole('manager', 'admin', 'inspector', 'contractor'),
  userController.listContacts
);

module.exports = router;
