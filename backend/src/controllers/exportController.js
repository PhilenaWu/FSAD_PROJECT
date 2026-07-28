// PowerPoint export controller (UC-005 task 5.13b, HLD §6.11).
// POST /api/export/pptx { views, filters } → { pptx_url }
'use strict';

const {
  fetchHeatmap,
  fetchTrends,
  fetchSlaCompliance,
  fetchContractorScorecard,
} = require('./analyticsController');
const {
  parseFilters,
  fetchCostSummary,
  fetchCostBreakdown,
  projectionsSuppressed,
} = require('./adminController');
const pptxService = require('../services/pptxService');
const cloudinaryService = require('../services/cloudinaryService');

const VALID_VIEWS = ['heatmap', 'trends', 'sla_gauge', 'contractor_scorecard'];

async function generatePptx(req, res, next) {
  const { views, filters = {} } = req.body || {};

  if (!Array.isArray(views) || views.length === 0 || !views.every((v) => VALID_VIEWS.includes(v))) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `views must be a non-empty array of: ${VALID_VIEWS.join(', ')}.`,
    });
  }

  try {
    // Fetch only the data the requested views need.
    const data = {
      heatmap: views.includes('heatmap') ? await fetchHeatmap(filters) : null,
      trends: views.includes('trends') ? await fetchTrends(filters) : null,
      sla: views.includes('sla_gauge') ? await fetchSlaCompliance(filters) : null,
      scorecard: views.includes('contractor_scorecard')
        ? await fetchContractorScorecard(filters)
        : null,
    };

    const buffer = await pptxService.buildDashboardDeck(views, filters, data);
    const filename = `dashboard-${Date.now()}.pptx`;
    const pptx_url = await cloudinaryService.uploadRaw(buffer, 'reports', filename);

    res.json({ pptx_url });
  } catch (err) {
    // PPT-T02: deck build or upload failure → EXPORT_FAILED; the dashboard
    // toasts the message and CSV export remains as the fallback.
    err.statusCode = 500;
    err.code = 'EXPORT_FAILED';
    err.message = 'Export failed — please try again or use CSV.';
    next(err);
  }
}

// POST /api/export/admin-costs-pptx (UC-011 task 5.19c) → { pptx_url }
// Admin only (gated in routes/export.js). Accepts the same filters as the cost
// dashboard endpoints, either as { filters: {...} } in the body or as query
// params, and re-runs the very same adminController fetchers the dashboard used
// — so the deck cannot drift from what the admin saw on screen.
async function generateAdminCostsPptx(req, res, next) {
  // Body filters win over query params when both name the same filter.
  const raw = { ...req.query, ...(req.body?.filters || {}) };
  const { filters, error } = parseFilters(raw);
  if (error) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: error });
  }

  try {
    const summary = await fetchCostSummary(filters);
    const { byCategory, byBlock, byContractor } = await fetchCostBreakdown(filters);

    const buffer = await pptxService.generateAdminCostPptx({
      filters,
      summary,
      byCategory,
      byBlock,
      byContractor,
      // Lets the deck caption a structurally-zero projected series rather than
      // letting the chart imply there is no risk.
      projections_suppressed: projectionsSuppressed(filters),
    });

    const filename = `admin-costs-${Date.now()}.pptx`;
    const pptx_url = await cloudinaryService.uploadRaw(buffer, 'reports', filename);

    res.json({ pptx_url });
  } catch (err) {
    // Same failure contract as the UC-005 deck: the UI toasts this and falls
    // back to CSV rather than showing a broken download.
    err.statusCode = 500;
    err.code = 'EXPORT_FAILED';
    err.message = 'Export failed — please try again or use CSV.';
    next(err);
  }
}

module.exports = { generatePptx, generateAdminCostsPptx };
