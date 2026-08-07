// Vendor lifecycle routes (UC-012), mounted at /api/admin/vendors. Admin-only:
// onboard, list, renew, suspend, edit details, audit history, and the contract
// expiry check (cron-guarded daily + admin on-demand).
'use strict';

const express = require('express');
const multer = require('multer');

const { requireAuth, requireRole } = require('../middleware/auth');
const { cronGuard } = require('../middleware/cronGuard');
const { isUuid } = require('../utils/validators');
const vendorController = require('../controllers/vendorController');

const router = express.Router();

// `contractors.id` is a UUID column, so an id like "abc" made Postgres raise a
// cast error (SQLSTATE 22P02) that reached the caller as a 500 quoting the
// database's own message. Every :id route below loads the vendor by this id —
// renew, suspend, PATCH, history — so each gets this guard, and each answers
// 404 exactly as it does for a well-formed id that names no vendor. An id that
// cannot identify a row is a miss, not a server fault.
//
// Placed after requireAuth/requireRole in each chain, not as a router.param:
// param handlers run before the route's middleware, which would let an
// unauthenticated caller tell a malformed id (404) from a well-formed one
// (401). Authentication answers first, always.
function requireUuidId(req, res, next) {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Vendor not found.' });
  }
  return next();
}

// Contract documents (PDF/DOCX) held in memory for the Cloudinary upload.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB, single file
});

// POST /api/admin/vendors — onboard a vendor (form-data, optional contract_doc).
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  upload.single('contract_doc'),
  vendorController.onboard
);

// GET /api/admin/vendors — vendor list sorted by contract_end ascending.
router.get('/', requireAuth, requireRole('admin'), vendorController.list);

// GET /api/admin/vendors/expiry-check — daily scheduled job; cron-secret only.
router.get('/expiry-check', cronGuard, vendorController.expiryCheck);

// POST /api/admin/vendors/run-expiry-check — same logic, triggered on demand by
// an admin from the vendor page ("Run expiry check now").
router.post('/run-expiry-check', requireAuth, requireRole('admin'), vendorController.expiryCheck);

// POST /api/admin/vendors/:id/renew — new contract_end (+ optional replacement
// contract document); reactivates a suspended account.
router.post(
  '/:id/renew',
  requireAuth,
  requireRole('admin'),
  requireUuidId,
  upload.single('contract_doc'),
  vendorController.renew
);

// POST /api/admin/vendors/:id/suspend — early termination; blocks login.
router.post('/:id/suspend', requireAuth, requireRole('admin'), requireUuidId, vendorController.suspend);

// PATCH /api/admin/vendors/:id — edit non-contract details (holder, contact…).
router.patch('/:id', requireAuth, requireRole('admin'), requireUuidId, vendorController.updateDetails);

// GET /api/admin/vendors/:id/history — vendor audit trail.
router.get('/:id/history', requireAuth, requireRole('admin'), requireUuidId, vendorController.getHistory);

module.exports = router;
