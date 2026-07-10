// AI recommendation controllers. Only listAlerts() is implemented here — the
// UC-005 dashboard reads active alerts from ai_predictions (task 5.13).
// runAnalysis(), acceptAlert(), dismissAlert() are UC-006 (Davian).
'use strict';

const { query } = require('../config/db');

// GET /api/recommendations?status=Active|Accepted|Dismissed|all (HLD §6.4)
async function listAlerts(req, res, next) {
  try {
    const status = req.query.status || 'Active';
    const params = [];
    let where = '';
    if (status !== 'all') {
      params.push(status);
      where = 'WHERE status = $1';
    }

    const { rows } = await query(
      `SELECT id, location_block, category, velocity_pct::float, alert_text,
              status, created_at
       FROM ai_predictions
       ${where}
       ORDER BY created_at DESC`,
      params
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAlerts };
