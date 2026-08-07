// Shared request-value validators.
//
// These exist so a malformed value is rejected before it reaches SQL. Postgres
// casts a bound parameter to the column's type, so an id of "abc" or a date of
// "hello" raises a cast error (SQLSTATE 22P02 / 22007) that surfaces to the
// caller as a 500 carrying the database's own message — both the wrong status
// and more about the schema than a client should see.
'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a canonical UUID string. */
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Real calendar date, not just the right shape — the round trip rejects
// 2026-02-30 and 2026-13-01, which a regex alone would happily accept.
function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Express hands back an array when a query param is repeated (?block=A&block=B).
// Silently taking one of them would quietly show the manager the wrong data, and
// passing the array on reaches the driver as the wrong parameter type.
function isSingleString(value) {
  return value === undefined || typeof value === 'string';
}

module.exports = { UUID_RE, isUuid, isRealDate, isSingleString };
