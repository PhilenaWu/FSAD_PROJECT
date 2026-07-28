// UC-011 admin cost analytics routes, mounted at /api/admin.
// The guard is applied with router.use() rather than per-route so every route
// added to this file in future is admin-only by default — there is no way to
// forget it. Mounted after /api/admin/vendors in app.js so the vendor router
// (UC-012) keeps its own more specific path.
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

const router = express.Router();

// Every admin endpoint below requires a valid Supabase token AND the admin role.
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/costs/summary → { total_actual, total_projected, variance_pct }
router.get('/costs/summary', adminController.getCostSummary);

// GET /api/admin/costs/breakdown → { byCategory, byBlock, byContractor }
router.get('/costs/breakdown', adminController.getCostBreakdown);

// GET /api/admin/costs/trends?months=12 → { data: [{ month, actual, projected }] }
router.get('/costs/trends', adminController.getCostTrends);

module.exports = router;
