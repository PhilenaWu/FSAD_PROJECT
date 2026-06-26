// Authentication: validate the Supabase access token, load the user's role.
'use strict';

const supabase = require('../config/supabase');
const db = require('../config/db');

function authError(message) {
  const err = new Error(message);
  err.statusCode = 401;
  err.code = 'UNAUTHENTICATED';
  return err;
}

// Verify the Supabase JWT sent by the frontend in `Authorization: Bearer <token>`.
// On success, attaches `req.user = { id, email }`. Auth happens in the browser
// (Supabase Auth); the backend only validates the resulting token here.
// getClaims() verifies the signature against the project's JWKS locally.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return next(authError('Missing bearer token'));
  }

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) {
    return next(authError('Invalid or expired token'));
  }

  // claims.sub is the Supabase auth user id. (claims.role is the Postgres role,
  // e.g. 'authenticated' — the app role is looked up in requireRole below.)
  req.user = { id: data.claims.sub, email: data.claims.email };
  next();
}

// Require the authenticated user to have one of the given roles. Role lives in
// the application `users` profile table (pg), keyed by the Supabase auth id.
// Use after requireAuth.
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) {
      return next(authError('Not authenticated'));
    }

    const { rows } = await db.query(
      'SELECT role, status FROM users WHERE id = $1',
      [req.user.id]
    );
    const profile = rows[0];

    if (!profile || profile.status !== 'active' || !roles.includes(profile.role)) {
      const err = new Error('Insufficient permissions');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      return next(err);
    }

    req.user.role = profile.role;
    next();
  };
}

module.exports = { requireAuth, requireRole };
