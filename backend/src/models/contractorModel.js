// DB queries for the contractors table.
'use strict';

const { query } = require('../config/db');

// All contractors, alphabetical — for the manager's assignment dropdown.
async function findAll() {
  const result = await query(
    'SELECT * FROM contractors ORDER BY name'
  );
  return result.rows;
}

// Look up a contractor by id. Returns the row, or undefined if none.
async function findById(id) {
  const result = await query('SELECT * FROM contractors WHERE id = $1', [id]);
  return result.rows[0];
}

// Insert a new vendor (UC-012 onboarding). user_id links the contractor login
// account created via Supabase Auth. Returns the created row.
async function createVendor(vendorData) {
  const {
    name,
    brands_serviced,
    contact_email,
    user_id,
    contract_start,
    contract_end,
    contract_doc_url,
    access_reason,
  } = vendorData;
  const result = await query(
    `INSERT INTO contractors
       (name, brands_serviced, contact_email, user_id,
        contract_start, contract_end, contract_doc_url, access_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [name, brands_serviced, contact_email, user_id,
     contract_start, contract_end, contract_doc_url, access_reason]
  );
  return result.rows[0];
}

// Vendor list for the admin page: contract fields, linked account status, and
// days until contract expiry — soonest-expiring first (UC-012).
async function listByContractEnd() {
  const result = await query(
    `SELECT c.id, c.name, c.contact_email, c.brands_serviced,
            to_char(c.contract_start, 'YYYY-MM-DD') AS contract_start,
            to_char(c.contract_end,   'YYYY-MM-DD') AS contract_end,
            c.contract_doc_url,
            c.access_reason,
            u.status, u.full_name AS account_holder, u.job_title,
            u.email AS login_email,
            (c.contract_end - CURRENT_DATE) AS days_until_expiry
     FROM contractors c
     LEFT JOIN users u ON u.id = c.user_id
     ORDER BY c.contract_end ASC NULLS LAST, c.name`
  );
  return result.rows;
}

// Renew a vendor: new contract_end, optional replacement contract document.
// Returns the updated row, or undefined if the id does not exist.
async function updateContract(id, contract_end, contract_doc_url) {
  const result = await query(
    `UPDATE contractors
     SET contract_end = $2,
         contract_doc_url = COALESCE($3, contract_doc_url)
     WHERE id = $1
     RETURNING *`,
    [id, contract_end, contract_doc_url]
  );
  return result.rows[0];
}

// Update a vendor's non-contract details (UC-012 edit dialog). Only supplied
// fields change; contract dates go through updateContract (renew) instead.
async function updateDetails(id, { contact_email, brands_serviced, access_reason }) {
  const result = await query(
    `UPDATE contractors
     SET contact_email   = COALESCE($2, contact_email),
         brands_serviced = COALESCE($3, brands_serviced),
         access_reason   = COALESCE($4, access_reason)
     WHERE id = $1
     RETURNING *`,
    [id, contact_email, brands_serviced, access_reason]
  );
  return result.rows[0];
}

// Vendors past their contract_end whose linked account is still active —
// input for the daily expiry check (UC-012).
async function findExpired() {
  const result = await query(
    `SELECT c.id, c.name, c.contact_email, c.contract_end, c.user_id
     FROM contractors c
     JOIN users u ON u.id = c.user_id
     WHERE c.contract_end < CURRENT_DATE AND u.status = 'active'`
  );
  return result.rows;
}

module.exports = {
  findAll,
  findById,
  createVendor,
  listByContractEnd,
  updateContract,
  updateDetails,
  findExpired,
};
