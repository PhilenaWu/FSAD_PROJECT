// Cron guard: gate scheduled-job routes behind a shared secret.
'use strict';

const config = require('../config/env');

// Validate `Authorization: Bearer <CRON_SECRET>` against the configured secret.
// Used for cron/scheduled endpoints where there's no logged-in user — just a
// trusted caller presenting the shared secret. On match, continue; otherwise 401.
//
// Reads the secret through config/env like every other consumer, rather than
// process.env directly, so there is one place that decides what the value is.
// The explicit config.CRON_SECRET check makes the closed-by-default behaviour
// obvious: with no secret configured the route is unreachable rather than open
// to a caller who also sends nothing.
function cronGuard(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (config.CRON_SECRET && token && token === config.CRON_SECRET) {
    return next();
  }

  return res.status(401).json({ code: 'UNAUTHORIZED' });
}

module.exports = { cronGuard };
