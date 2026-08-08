// UC-003 controllers — the originator's own view of a record they filed, their
// archive of closed ones, and the satisfaction rating they leave on the outcome.
// Everything here is scoped to req.user; a record belonging to someone else is a
// 404, not a 403, so the endpoint never confirms the existence of a record it
// won't show.
'use strict';

const myReportModel = require('../models/myReportModel');
const notificationService = require('../services/notificationService');
const { CATEGORIES } = require('../utils/inspectionOptions');

// A resident's report can be edited for a short window after submission —
// long enough to fix a typo or add detail shortly after filing. Time-only:
// not also gated on status, so an edit still goes through even if a manager
// has already started triaging within the window — a deliberately simple
// rule, not a guarantee against that overlap.
const EDIT_WINDOW_MS = 30 * 60 * 1000;

// A rating is offered once the work is done. 'Closed' is included deliberately:
// the workflow runs Assigned → Acknowledged → Rectified → Closed and only reaches
// 'Resolved' if a manager sets it by hand, so gating on 'Resolved' alone would
// mean most reports could never be rated at all. Closed records stay readable in
// the originator's history, which is where that rating is left.
const RATABLE_STATUSES = ['Resolved', 'Closed'];

// GET /api/my-reports/history — the caller's closed records, newest first. The
// active list lives on GET /api/inspections/my, which excludes these.
async function listOwnHistory(req, res, next) {
  try {
    const data = await myReportModel.findOwnArchived(req.user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// GET /api/my-reports/:id — full detail for one of the caller's own records
// (live or closed): the row, its audit history, and its checklist results.
async function getOwnDetail(req, res, next) {
  try {
    const inspection = await myReportModel.findOwnDetail(req.params.id, req.user.id);
    if (!inspection) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Report not found.',
      });
    }
    res.json(inspection);
  } catch (err) {
    next(err);
  }
}

// POST /api/my-reports/:id/rating — resident rates the resolution (UC-003
// main flow 7-9). One rating per record; a second attempt is a 409.
async function submitRating(req, res, next) {
  try {
    const { rating, comment } = req.body;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'rating must be a whole number between 1 and 5.',
      });
    }

    const existing = await myReportModel.findOwnRecord(req.params.id, req.user.id);
    if (!existing) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Report not found.',
      });
    }
    if (existing.satisfaction_rating !== null) {
      return res.status(409).json({
        code: 'ALREADY_RATED',
        message: 'You have already submitted a rating for this record.',
      });
    }
    if (!RATABLE_STATUSES.includes(existing.status)) {
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: 'This report can be rated once the work is done.',
      });
    }

    const inspection = await myReportModel.submitRating(req.params.id, req.user.id, {
      rating,
      comment,
    });

    // Satisfaction feedback is only useful if a manager sees it — a rating left
    // in the database that nobody is told about cannot inform anything. A low
    // score is flagged Warning so it stands out from routine praise.
    await notificationService.notifyEvent({
      event_type: 'rating_submitted',
      scope: { type: 'managers' },
      message: `${rating}★ rating left on "${existing.title}"${comment ? ` — "${comment}"` : ''}`,
      urgency: rating <= 2 ? 'Warning' : 'Informational',
      link: `/inspections/${inspection.id}`,
    });

    res.json({
      id: inspection.id,
      satisfaction_rating: inspection.satisfaction_rating,
      satisfaction_comment: inspection.satisfaction_comment,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/my-reports/:id — resident edits their own complaint (title,
// description, category, location) within EDIT_WINDOW_MS of filing it. The
// photo is not editable here — see myReportModel.updateOwnReport.
async function updateOwnReport(req, res, next) {
  try {
    const existing = await myReportModel.findOwnRecord(req.params.id, req.user.id);
    if (!existing || existing.resident_id !== req.user.id) {
      // Not found, or it's the caller's own *inspection* (inspector role) —
      // either way this route only edits a resident's complaint, and the
      // caller shouldn't be able to tell those two cases apart.
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'Report not found.',
      });
    }

    if (Date.now() - new Date(existing.created_at).getTime() > EDIT_WINDOW_MS) {
      return res.status(409).json({
        code: 'EDIT_WINDOW_EXPIRED',
        message: 'Reports can only be edited within 30 minutes of submission.',
      });
    }

    const { title, description, category, location_block, location_unit } = req.body;
    if (!title || !description || !location_block || !category) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'title, description, location_block and category are required.',
      });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `category must be one of: ${CATEGORIES.join(', ')}.`,
      });
    }

    const inspection = await myReportModel.updateOwnReport(req.params.id, req.user.id, {
      title,
      description,
      category,
      location_block,
      location_unit: location_unit || null,
    });
    res.json(inspection);
  } catch (err) {
    next(err);
  }
}

module.exports = { getOwnDetail, listOwnHistory, submitRating, updateOwnReport };
