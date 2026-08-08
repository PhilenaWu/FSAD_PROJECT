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

// Statuses that hold a valid Supabase token but must reach no application
// route. A self-registered resident sits at 'pending' until a manager approves
// them, so gating this in one place (rather than per route) is what makes
// "pending gets nothing" true of every endpoint, including future ones.
// Each gets its own code so the frontend can explain the specific reason.
const BLOCKED_STATUSES = {
  pending: {
    code: 'ACCOUNT_PENDING',
    message: 'Your account is awaiting manager approval.',
  },
  rejected: {
    code: 'ACCOUNT_REJECTED',
    message: 'Your registration request was not approved.',
  },
};

function blockedStatusError(status) {
  const blocked = BLOCKED_STATUSES[status];
  if (!blocked) return null;
  const err = new Error(blocked.message);
  err.statusCode = 403;
  err.code = blocked.code;
  return err;
}

// Verify the Supabase JWT sent by the frontend in `Authorization: Bearer <token>`.
// On success, attaches `req.user = { id, email, role, status }`. Auth happens in
// the browser (Supabase Auth); the backend only validates the resulting token
// here. getClaims() verifies the signature against the project's JWKS locally.
//
// G16: the suspension gate lives here, not only in GET /api/users/me. A
// suspended vendor still holds a valid Supabase token — Supabase has no idea we
// suspended them — so checking status only in getMe meant a terminated
// contractor was refused their own profile but could still call every
// requireAuth-only route (the estate status board among them). Refused with
// ACCOUNT_SUSPENDED rather than FORBIDDEN so the frontend can sign them out
// instead of showing a generic permissions error; the code matches what getMe
// already returns.
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
  // e.g. 'authenticated' — the app role comes from the users profile row.)
  req.user = { id: data.claims.sub, email: data.claims.email };

  // Load the profile once here so requireRole below doesn't repeat the query.
  const { rows } = await db.query(
    'SELECT role, status FROM users WHERE id = $1',
    [req.user.id]
  );
  const profile = rows[0];

  // A missing profile row is deliberately NOT rejected here: getMe answers that
  // case with its own 404, and requireRole still refuses the request anyway.
  if (profile) {
    if (profile.status === 'suspended') {
      const err = new Error('This account is suspended. Contact the administrator.');
      err.statusCode = 403;
      err.code = 'ACCOUNT_SUSPENDED';
      return next(err);
    }
    // Same gate, same place, for the self-registration statuses.
    const blocked = blockedStatusError(profile.status);
    if (blocked) {
      return next(blocked);
    }
    req.user.role = profile.role;
    req.user.status = profile.status;
  }

  next();
}

// Require the authenticated user to have one of the given roles. Role lives in
// the application `users` profile table (pg), keyed by the Supabase auth id.
// Use after requireAuth, which has already loaded and checked the profile.
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) {
      return next(authError('Not authenticated'));
    }

    // Normally populated by requireAuth. The fallback covers this guard being
    // mounted on its own, so the role check can never silently pass.
    let { role, status } = req.user;
    if (role === undefined) {
      const { rows } = await db.query(
        'SELECT role, status FROM users WHERE id = $1',
        [req.user.id]
      );
      role = rows[0]?.role;
      status = rows[0]?.status;
      req.user.role = role;
      req.user.status = status;
    }

    // G16: a suspended account gets the specific ACCOUNT_SUSPENDED code, not a
    // generic FORBIDDEN — the frontend signs them out on it, and "your account
    // is suspended" is a different message from "you're the wrong role".
    // requireAuth normally catches this first; this covers the fallback path
    // above, where the profile was loaded here.
    if (status === 'suspended') {
      const err = new Error('This account is suspended. Contact the administrator.');
      err.statusCode = 403;
      err.code = 'ACCOUNT_SUSPENDED';
      return next(err);
    }

    const blocked = blockedStatusError(status);
    if (blocked) {
      return next(blocked);
    }

    if (!role || status !== 'active' || !roles.includes(role)) {
      const err = new Error('Insufficient permissions');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      return next(err);
    }

    next();
  };
}

module.exports = { requireAuth, requireRole };
