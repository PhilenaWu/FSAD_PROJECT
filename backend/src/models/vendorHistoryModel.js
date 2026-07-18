// DB queries for the vendor_history audit trail (UC-012).
'use strict';

const { query } = require('../config/db');

// Record a lifecycle action. actorId is null for system actions (expiry job).
async function add(contractorId, actorId, action, note) {
  const result = await query(
    `INSERT INTO vendor_history (contractor_id, actor_id, action, note)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [contractorId, actorId, action, note]
  );
  return result.rows[0];
}

// Full history for one vendor, newest first, with the actor's name resolved
// ("System" when no actor — automated actions).
async function listByContractor(contractorId) {
  const result = await query(
    `SELECT h.id, h.action, h.note, h.created_at,
            COALESCE(u.full_name, 'System') AS actor_name
     FROM vendor_history h
     LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.contractor_id = $1
     ORDER BY h.created_at DESC`,
    [contractorId]
  );
  return result.rows;
}

module.exports = { add, listByContractor };
