// Supabase PostgreSQL connection pool (pg)
'use strict';

const { Pool } = require('pg');
const config = require('./env');

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
