// DB queries for users table
'use strict';

const { query } = require('../config/db');

// Look up a user profile by email. Returns the row, or undefined if none.
async function findByEmail(email) {
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0];
}

// Insert a new user profile. `id` is the Supabase auth user id, supplied by the
// caller. block_number/unit_number are optional (residents only); job_title is
// optional (vendor account holders only); status and timestamps fall back to
// their DB defaults. Returns the created row.
async function create(userData) {
  const { id, email, full_name, role, block_number, unit_number, job_title } = userData;
  const result = await query(
    `INSERT INTO users (id, email, full_name, role, block_number, unit_number, job_title)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, email, full_name, role, block_number, unit_number, job_title]
  );
  return result.rows[0];
}

// Resident self-registration. role and status are SQL literals, not parameters,
// so no request body can influence them however it is shaped — this is the only
// insert path open to an unapproved caller. Returns the created row.
async function createPendingResident({ id, email, full_name, block_number, unit_number }) {
  const result = await query(
    `INSERT INTO users (id, email, full_name, role, status, block_number, unit_number)
     VALUES ($1, $2, $3, 'resident', 'pending', $4, $5)
     RETURNING *`,
    [id, email, full_name, block_number, unit_number]
  );
  return result.rows[0];
}

// Registration requests awaiting a manager decision, oldest first so the
// longest-waiting resident is dealt with first.
async function findPendingResidents() {
  const result = await query(
    `SELECT id, full_name, email, block_number, unit_number, created_at
     FROM users
     WHERE role = 'resident' AND status = 'pending'
     ORDER BY created_at ASC`
  );
  return result.rows;
}

// Look up a user profile by id. Returns the row, or undefined if none.
async function findById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

// Active inspectors, for the UC-004 endorser picker (G7: the endorsing
// signature must belong to an inspector). Minimal projection — the manager
// only needs to name and identify them.
async function findActiveInspectors() {
  const result = await query(
    `SELECT id, full_name, email
     FROM users
     WHERE role = 'inspector' AND status = 'active'
     ORDER BY full_name`
  );
  return result.rows;
}

// Active holders of a role, for the role contacts pages and the sidebar help
// card. Same minimal projection as findActiveInspectors plus the phone added in
// migration 038 — a contacts list needs a way to reach the person and nothing
// else. phone is nullable, so callers must tolerate null.
async function findActiveContactsByRole(role) {
  const result = await query(
    `SELECT id, full_name, email, phone
     FROM users
     WHERE role = $1 AND status = 'active'
     ORDER BY full_name`,
    [role]
  );
  return result.rows;
}

// Set a user's account status ('active' | 'suspended' | 'pending' |
// 'rejected') — UC-012 suspend/renew and resident approve/reject.
// Returns the updated row, or undefined if the id does not exist.
async function setStatus(id, status) {
  const result = await query(
    `UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return result.rows[0];
}

// Back-reference a contractor login account to its contractors row (UC-012
// onboarding — the contractors row is created after the user profile).
async function setContractorId(id, contractorId) {
  const result = await query(
    `UPDATE users SET contractor_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, contractorId]
  );
  return result.rows[0];
}

// Update a vendor account holder's name/title (UC-012 edit dialog). Only
// supplied fields change.
async function updateHolder(id, { full_name, job_title }) {
  const result = await query(
    `UPDATE users
     SET full_name = COALESCE($2, full_name),
         job_title = COALESCE($3, job_title),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, full_name, job_title]
  );
  return result.rows[0];
}

module.exports = {
  findByEmail,
  create,
  createPendingResident,
  findPendingResidents,
  findById,
  findActiveInspectors,
  findActiveContactsByRole,
  setStatus,
  setContractorId,
  updateHolder,
};
