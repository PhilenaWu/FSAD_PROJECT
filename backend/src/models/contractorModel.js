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

module.exports = { findAll };
