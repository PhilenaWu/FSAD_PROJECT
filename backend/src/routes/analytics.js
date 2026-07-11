// UC-005 analytics routes — all manager-only (HLD §6.3).
'use strict';

const express = require('express');

const { requireAuth, requireRole } = require('../middleware/auth');
const analyticsController = require('../controllers/analyticsController');

const router = express.Router();

// Every analytics endpoint is manager-only.
router.use(requireAuth, requireRole('manager'));

router.get('/filter-options', analyticsController.getFilterOptions);
router.get('/summary', analyticsController.getSummary);
router.get('/issues-by-block', analyticsController.getHeatmap);
router.get('/trends', analyticsController.getTrends);
router.get('/sla-compliance', analyticsController.getSlaCompliance);
router.get('/contractor-scorecard', analyticsController.getContractorScorecard);
router.get('/priority-queue', analyticsController.getPriorityQueue);

module.exports = router;
