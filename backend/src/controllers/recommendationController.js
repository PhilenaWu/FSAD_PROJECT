// AI recommendation controllers.
//   listAlerts()  — UC-005 dashboard read (active alerts from ai_predictions).
//   runAnalysis() — UC-006 orchestration: drain ai_jobs, scan for rising
//                   defect trends, and persist alerts for eligible pairs.
//   acceptAlert() / dismissAlert() — UC-006 manager actions on an alert.
'use strict';

const db = require('../config/db');
const aiPredictionModel = require('../models/aiPredictionModel');
const openaiService = require('../services/openaiService');
const notificationService = require('../services/notificationService');
const socketService = require('../services/socketService');
const { calculateVelocity } = require('../utils/velocityCalculator');

const VELOCITY_ALERT_THRESHOLD = 40; // percent
const PREDICTED_OCCURRENCES = 1; // placeholder for "occurrences next period"

// GET /api/recommendations?status=Active|Accepted|Dismissed|all (HLD §6.4)
async function listAlerts(req, res, next) {
  try {
    const status = req.query.status || 'Active';
    const rows = await aiPredictionModel.list(status);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

/**
 * Average actual_cost of past closed records of a category, projected forward.
 * estimated_cost = avg(actual_cost) × PREDICTED_OCCURRENCES. Only records with a
 * non-null actual_cost count (actual_cost is entered at close), so this is the
 * cost history of resolved work. Returns null when there is no cost history.
 *
 * @param {string} category
 * @returns {Promise<number|null>} rounded projected cost, or null.
 */
async function estimateCost(category) {
  const { rows } = await db.query(
    `SELECT AVG(actual_cost)::float AS avg_cost
       FROM inspections
      WHERE is_deleted = FALSE
        AND category = $1
        AND actual_cost IS NOT NULL`,
    [category]
  );
  const avg = rows[0]?.avg_cost;
  if (avg == null) return null;
  return Math.round(avg * PREDICTED_OCCURRENCES * 100) / 100;
}

/**
 * Evaluate one (block, category) pair and, if it clears the threshold, persist
 * an alert. A pair is alertable when calculateVelocity marks it eligible
 * (>= 3 current records) and velocity_pct >= 40.
 *
 * @param {string} block
 * @param {string} category
 * @returns {Promise<Object|null>} the created prediction row, or null if skipped.
 */
async function evaluatePair(block, category) {
  const velocity = await calculateVelocity(block, category, db);

  if (!velocity.is_eligible || velocity.velocity_pct < VELOCITY_ALERT_THRESHOLD) {
    return null; // skipped — insufficient data or below threshold
  }

  const estimated_cost = await estimateCost(category);
  const alert_text = await openaiService.generateRiskAlert(
    block,
    category,
    velocity.velocity_pct,
    estimated_cost
  );

  return aiPredictionModel.insert({
    location_block: block,
    category,
    velocity_pct: velocity.velocity_pct,
    estimated_cost,
    alert_text,
  });
}

/**
 * GET /api/recommendations/run — run the UC-006 analysis.
 *
 * Order of work:
 *   1. Drain ai_jobs (status = 'pending') and process those block+category
 *      pairs first (elevated priority), then mark the jobs 'processed'.
 *   2. General scan: every block+category pair with >= 3 records in the last 60
 *      days (enough history for calculateVelocity).
 * Pairs seen in step 1 are not re-evaluated in step 2. Each pair is scored with
 * calculateVelocity; eligible pairs at/above the 40% threshold get an alert row.
 *
 * Access is enforced by the route guard (CRON_SECRET bearer for scheduled runs,
 * or a manager session for on-demand runs).
 *
 * @returns {void} responds with
 *   { alerts_generated, generated: [...], skipped: [...], jobs_processed }.
 * @throws forwards DB errors to the Express error handler.
 */
async function runAnalysis(req, res, next) {
  try {
    const seen = new Set(); // "block\x00category" — dedupe across jobs + scan
    const pairs = [];
    const addPair = (block, category) => {
      const key = `${block}\x00${category}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ block, category });
    };

    // 1. Priority: pending ai_jobs.
    const { rows: jobs } = await db.query(
      `SELECT id, location_block, category
         FROM ai_jobs
        WHERE status = 'pending'`
    );
    for (const job of jobs) {
      addPair(job.location_block, job.category);
    }

    // 2. General scan: pairs with enough recent history for a velocity read.
    const scanCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { rows: scanPairs } = await db.query(
      `SELECT location_block, category
         FROM inspections
        WHERE is_deleted = FALSE
          AND created_at >= $1
        GROUP BY location_block, category
        HAVING COUNT(*) >= 3`,
      [scanCutoff]
    );
    for (const p of scanPairs) {
      addPair(p.location_block, p.category);
    }

    // Evaluate every unique pair.
    const generated = [];
    const skipped = [];
    for (const { block, category } of pairs) {
      const prediction = await evaluatePair(block, category);
      if (prediction) {
        generated.push(prediction);
      } else {
        skipped.push({ location_block: block, category });
      }
    }

    // Mark the drained jobs processed (whether or not they produced an alert —
    // they were evaluated).
    if (jobs.length > 0) {
      await db.query(
        `UPDATE ai_jobs SET status = 'processed' WHERE id = ANY($1)`,
        [jobs.map((j) => j.id)]
      );
    }

    // This runs nightly on a cron, so nobody is watching when alerts appear.
    // One summary per run rather than one per alert: a scan that flags eight
    // block/category pairs should not push eight separate bell entries.
    if (generated.length > 0) {
      await notificationService.notifyEvent({
        event_type: 'ai_alerts_generated',
        scope: { type: 'managers' },
        message: `${generated.length} new AI risk alert(s) — ${generated
          .slice(0, 3)
          .map((g) => `Blk ${g.location_block}/${g.category}`)
          .join(', ')}${generated.length > 3 ? '…' : ''}`,
        urgency: 'Warning',
        link: '/dashboard',
      });
    }

    res.json({
      alerts_generated: generated.length,
      generated,
      skipped,
      jobs_processed: jobs.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/recommendations/:id/accept — manager accepts an alert. Flips the
 * prediction to 'Accepted' and opens a preventive-maintenance inspection for
 * the block/category so it enters the normal workflow.
 *
 * Note: the inspection is marked source_flag = 'AI-Generated' (the authoritative
 * AI marker). source_type uses the valid 'cv_auto_detected' discriminator since
 * the schema CHECK has no 'AI' source_type; the projected cost is recorded in
 * the description (inspections has no estimated_cost column).
 *
 * @returns {void} responds with { prediction_id, status, inspection_id }.
 * @throws 404 if the prediction id is unknown; forwards DB errors otherwise.
 */
async function acceptAlert(req, res, next) {
  try {
    const { id } = req.params;
    const prediction = await aiPredictionModel.updateStatus(id, 'Accepted', req.user.id);
    if (!prediction) {
      const err = new Error('Prediction not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      return next(err);
    }

    const costNote =
      prediction.estimated_cost != null
        ? ` Projected cost impact: about $${Math.round(prediction.estimated_cost)}.`
        : '';
    const title = `Preventive maintenance — ${prediction.category} (Block ${prediction.location_block})`;
    const description =
      `Auto-created from AI risk alert (velocity ${prediction.velocity_pct}% ` +
      `over 30 days).${costNote}`;

    const { rows } = await db.query(
      `INSERT INTO inspections
         (source_type, title, description, location_block, category,
          source_flag, status)
       VALUES ('cv_auto_detected', $1, $2, $3, $4, 'AI-Generated', 'Open')
       RETURNING id`,
      [title, description, prediction.location_block, prediction.category]
    );

    // Notify managers to refresh the priority queue with the new inspection
    socketService.emitToRoom('manager-room', 'priority_queue_update', {
      action: 'inspection_created',
      inspection_id: rows[0].id,
      title,
      location_block: prediction.location_block,
      category: prediction.category,
    });

    res.json({
      prediction_id: prediction.id,
      status: prediction.status,
      inspection_id: rows[0].id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/recommendations/:id/dismiss — manager dismisses an alert. Flips the
 * prediction to 'Dismissed' and stamps dismissed_at + dismissed_by.
 *
 * @returns {void} responds with { prediction_id, status }.
 * @throws 404 if the prediction id is unknown; forwards DB errors otherwise.
 */
async function dismissAlert(req, res, next) {
  try {
    const { id } = req.params;
    const prediction = await aiPredictionModel.updateStatus(id, 'Dismissed', req.user.id);
    if (!prediction) {
      const err = new Error('Prediction not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      return next(err);
    }
    res.json({ prediction_id: prediction.id, status: prediction.status });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAlerts, runAnalysis, acceptAlert, dismissAlert };
