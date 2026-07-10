// express-rate-limit config
'use strict';

const rateLimit = require('express-rate-limit');

// Global safety net. HLD §7 scopes the strict 100/15min limit to auth routes
// only (which live in Supabase, not here); the app-wide net is looser because
// the UC-005 dashboard alone fires 6 API calls per load/filter change — at
// max 100 a manager hit 429s within minutes and the profile fetch failure
// dropped them to the resident layout.
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
});

module.exports = rateLimiter;
