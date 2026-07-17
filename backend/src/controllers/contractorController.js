// Contractor controllers. Managers list contractors to assign defects (UC-002).
'use strict';

const contractorModel = require('../models/contractorModel');

// GET /api/contractors — all contractors, for the assignment dropdown.
async function list(req, res, next) {
  try {
    const contractors = await contractorModel.findAll();
    res.json(contractors);
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
