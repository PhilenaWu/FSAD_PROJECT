// DB queries for general app feedback (sidebar "Feedback" form — any role).
'use strict';

const { query } = require('../config/db');

async function createFeedback({ userId, message, rating }) {
  const result = await query(
    `INSERT INTO feedback (user_id, message, rating)
     VALUES ($1, $2, $3)
     RETURNING id, message, rating, created_at`,
    [userId, message, rating ?? null]
  );
  return result.rows[0];
}

module.exports = { createFeedback };
