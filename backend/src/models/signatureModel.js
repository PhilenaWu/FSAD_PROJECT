// DB queries for the signatures table (e-signature endorsements, UC-004/UC-010).
'use strict';

const { query: defaultQuery } = require('../config/db');

// Insert one signature row. Pass a transaction `client` to enrol in an ongoing
// transaction (e.g. the close flow); otherwise the shared pool is used.
async function create({ inspection_id, signer_role, signer_id, image_url }, client) {
  const run = client ? client.query.bind(client) : defaultQuery;
  const result = await run(
    `INSERT INTO signatures (inspection_id, signer_role, signer_id, image_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [inspection_id, signer_role, signer_id, image_url]
  );
  return result.rows[0];
}

// All signatures on a record, oldest first.
async function findByInspection(inspectionId) {
  const result = await defaultQuery(
    'SELECT * FROM signatures WHERE inspection_id = $1 ORDER BY signed_at',
    [inspectionId]
  );
  return result.rows;
}

module.exports = { create, findByInspection };
