// Checklist item controllers. Serves the spot-check template.
'use strict';

const checklistItemModel = require('../models/checklistItemModel');

// GET /api/checklist-items — active template items, sorted by display_order.
async function list(req, res, next) {
  try {
    const items = await checklistItemModel.findActive();
    res.json(items);
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
