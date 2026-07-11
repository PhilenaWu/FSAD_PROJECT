// DB queries for the checklist_items table (the spot-check template).
'use strict';

const { query } = require('../config/db');

// List the active template items in display order, for the inspector's form.
async function findActive() {
  const result = await query(
    `SELECT * FROM checklist_items
     WHERE active = TRUE
     ORDER BY display_order`
  );
  return result.rows;
}

module.exports = { findActive };
