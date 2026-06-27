// DB queries for users table
'use strict';

const { query } = require('../config/db');

// Look up a user profile by email. Returns the row, or undefined if none.
async function findByEmail(email) {
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0];
}

// Insert a new user profile. `id` is the Supabase auth user id, supplied by the
// caller. block_number/unit_number are optional (residents only); status and
// timestamps fall back to their DB defaults. Returns the created row.
async function create(userData) {
  const { id, email, full_name, role, block_number, unit_number } = userData;
  const result = await query(
    `INSERT INTO users (id, email, full_name, role, block_number, unit_number)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, email, full_name, role, block_number, unit_number]
  );
  return result.rows[0];
}

// Look up a user profile by id. Returns the row, or undefined if none.
async function findById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

module.exports = { findByEmail, create, findById };
