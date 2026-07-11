// Lift controllers. Inspectors list lifts to pick one for a spot-check.
'use strict';

const liftModel = require('../models/liftModel');

// GET /api/lifts — all lifts with their responsible contractor's name.
async function list(req, res, next) {
  try {
    const lifts = await liftModel.findAll();
    res.json(lifts);
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
