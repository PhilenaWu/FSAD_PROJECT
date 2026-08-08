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

// The cost endpoints accept the same optional filters, validated in the
// controller before any SQL runs (see parseFilters):
//   ?startDate=YYYY-MM-DD  ?endDate=YYYY-MM-DD (inclusive)
//   ?block=44A  ?category=Doors  ?liftId=<uuid>  ?contractorId=<uuid>
// liftId and contractorId zero the projected series — ai_predictions has no
// lift or contractor column to filter on.
// (/costs/filter-options is the exception: it takes no parameters.)

// GET /api/admin/costs/summary → { total_actual, total_projected, variance_pct, jobs }
router.get('/costs/summary', adminController.getCostSummary);

// GET /api/admin/costs/filter-options → { blocks, categories, contractors:[{id,name}] }
// Declared before /costs/:anything-style routes would be, and kept above the
// row endpoints for readability — Express matches these literal paths exactly.
router.get('/costs/filter-options', adminController.getCostFilterOptions);

// GET /api/admin/costs/jobs → { data: [{ id, closed_at, block, category, lift,
// contractor, actual_cost }] } — the job-level rows behind the aggregates.
router.get('/costs/jobs', adminController.getCostJobs);

// GET /api/admin/costs/breakdown → { byCategory, byBlock, byContractor }
// AdminVendorPage's sibling, AdminCostPage, does NOT call this: it already
// fetches /costs/jobs for the drill-down table, CSV, watchlist and forecast,
// and groups those rows client-side rather than paying a second round-trip for
// figures it holds. The route stays because the cost deck's server-side
// renderer uses the same fetcher (exportController.generateAdminCostsPptx),
// and because a client without the job rows needs it.
router.get('/costs/breakdown', adminController.getCostBreakdown);

// GET /api/admin/costs/trends?months=12 → { data: [{ month, actual, projected }] }
// `months` applies only when no date range is given.
// No caller today, for the same reason as /costs/breakdown — the page builds
// its monthly line from the job rows (costService.buildTrend), which it also
// needs for the projection and the backtest. Kept, with tests, as the
// aggregate-only route: unlike buildTrend it carries the projected series and
// fills gap months in SQL.
router.get('/costs/trends', adminController.getCostTrends);

module.exports = router;
