// PowerPoint export controller (UC-005 task 5.13b, HLD §6.11).
// POST /api/export/pptx { views, filters } → { pptx_url }
'use strict';

const {
  fetchHeatmap,
  fetchTrends,
  fetchSlaCompliance,
  fetchContractorScorecard,
} = require('./analyticsController');
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

module.exports = { generatePptx };
