// Supabase PostgreSQL connection pool (pg)
'use strict';

const { Pool, types } = require('pg');
const config = require('./env');

// Every TIMESTAMP column in this schema (see migrations/*.sql) stores a UTC
// wall-clock value with no tz marker. pg's default parser for that type (OID
// 1114) reads the naive string as local server time, silently shifting every
// value by the server's UTC offset once converted to a JS Date. Force UTC
// parsing so it matches what's actually stored.
types.setTypeParser(1114, (str) => new Date(str + 'Z'));

// Single shared pool for the whole process. DATABASE_URL should point at the
// Supabase connection pooler (port 6543, transaction mode) with sslmode=require.
//
// Supabase requires SSL. `rejectUnauthorized: false` accepts the connection
// without verifying the chain — adequate for a managed provider over TLS. For
// stricter verification, download the Supabase CA cert and pass it as ssl.ca.
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  // Fail fast: if the handshake doesn't complete in 10s (e.g. a network that
  // blocks the Postgres port), reject instead of hanging forever so startup
  // surfaces a clear error rather than silently never listening.
  connectionTimeoutMillis: 10000,
});

// Errors on idle clients are emitted here; log them so a dropped backend
// connection doesn't crash the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
});

// Thin query helper so callers don't each acquire/release a client.
function query(text, params) {
  return pool.query(text, params);
}

// Verify connectivity at startup. Resolves on success, rejects otherwise.
async function testConnection() {
  await pool.query('SELECT 1');
}

module.exports = { pool, query, testConnection };
