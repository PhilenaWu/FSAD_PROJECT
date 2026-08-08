// DB queries for the contact directory (migration 039) — the estate and
// emergency numbers that are not user accounts.
'use strict';

const { query } = require('../config/db');

// The whole directory, in display order. Small and static enough that paging or
// filtering would be noise — the emergency contacts page shows all of it.
async function findAll() {
  const result = await query(
    `SELECT id, label, description, phone, category, icon_key, is_help_line
     FROM contact_directory
     ORDER BY sort_order, label`
  );
  return result.rows;
}

module.exports = { findAll };
