// Contact directory — the estate and emergency numbers behind the sidebar
// "Need help?" card and the emergency contacts page.
'use strict';

const contactDirectoryModel = require('../models/contactDirectoryModel');

// GET /api/contacts — the full directory. Any signed-in role: a resident needs
// the managing office and the emergency lines, and none of it is sensitive.
async function listDirectory(req, res, next) {
  try {
    res.json(await contactDirectoryModel.findAll());
  } catch (err) {
    next(err);
  }
}

module.exports = { listDirectory };
