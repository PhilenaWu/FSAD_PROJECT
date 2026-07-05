// Incident controllers. UC-001: a resident creates an incident with an optional
// photo, which is AI-categorised. (list/assign/close/rate land with UC-002+.)
'use strict';

const { query } = require('../config/db');
const incidentModel = require('../models/incidentModel');
const cloudinaryService = require('../services/cloudinaryService');
const openaiService = require('../services/openaiService');

// POST /api/incidents — resident submits a new incident.
async function create(req, res, next) {
  try {
    const resident_id = req.user.id;
    const { title, description, location_block, location_unit } = req.body;

    // Minimal required-field validation.
    if (!title || !description || !location_block) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'title, description and location_block are required.',
      });
    }

    // Duplicate guard: same resident + title within the last 2 minutes is almost
    // certainly a double submit. One-off query, so it lives here rather than in
    // the model (which stays to its three UC-001 methods for now).
    const dup = await query(
      `SELECT id FROM incidents
       WHERE resident_id = $1 AND title = $2
         AND is_deleted = FALSE
         AND created_at > NOW() - INTERVAL '2 minutes'
       LIMIT 1`,
      [resident_id, title]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({
        code: 'DUPLICATE_SUBMISSION',
        message: 'You already submitted an incident with this title moments ago.',
      });
    }

    // Optional photo → Cloudinary (defects folder). multer puts it on req.file.
    let photo_url;
    if (req.file) {
      photo_url = await cloudinaryService.uploadImage(req.file.buffer, 'defects');
    }

    // AI categorisation (currently stubbed).
    const { category, priority_score } = await openaiService.categoriseIncident(
      title,
      description
    );

    const incident = await incidentModel.create({
      resident_id,
      title,
      description,
      location_block,
      location_unit,
      photo_url,
      category,
      ai_priority_score: priority_score,
    });

    res.status(201).json(incident);
  } catch (err) {
    next(err);
  }
}

module.exports = { create };
