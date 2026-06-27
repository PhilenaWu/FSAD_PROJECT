// Cron guard: gate scheduled-job routes behind a shared secret.
'use strict';

// Validate `Authorization: Bearer <CRON_SECRET>` against process.env.CRON_SECRET.
// Used for cron/scheduled endpoints where there's no logged-in user — just a
// trusted caller presenting the shared secret. On match, continue; otherwise 401.
function cronGuard(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token && token === process.env.CRON_SECRET) {
    return next();
  }

  return res.status(401).json({ code: 'UNAUTHORIZED' });
}

module.exports = { cronGuard };
