// express-rate-limit config
'use strict';

const rateLimit = require('express-rate-limit');

// 100 requests / 15 min per IP. Applied globally as a safety net and
// reusable on sensitive routes (e.g. auth) once they exist.
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
});

module.exports = rateLimiter;
