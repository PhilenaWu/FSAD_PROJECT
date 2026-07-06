// User controller. GET /api/users/me — returns the caller's own profile row.
'use strict';

const userModel = require('../models/userModel');

// Return the authenticated user's `users` row. The row id is the Supabase auth
// uid (set by requireAuth as req.user.id), so we look it up directly.
async function getMe(req, res, next) {
  try {
    const profile = await userModel.findById(req.user.id);
    if (!profile) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Profile not found' });
    }
    res.json(profile); // raw row, per convention
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe };
