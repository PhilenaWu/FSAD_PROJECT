// DB queries for notifications + notification_recipients (UC-008). Raw SQL via
// the shared pg pool, following inspectionModel.js style.
//
// scope shape (validated in the controller):
//   { type: 'blocks', blocks: ['44A','44B'] } — residents in those blocks
//   { type: 'all_blocks' }                    — all residents
//   { type: 'contractor', contractor_user_id } — one contractor account
//   { type: 'inspector_team' }                — all inspectors
'use strict';

const { query } = require('../config/db');

// Insert a notifications row. `status`/`send_time`/`sent_at` are supplied by the
// caller: immediate sends pass status 'Sent' + sent_at; scheduled sends pass
// status 'Scheduled' + send_time and leave sent_at NULL. Returns the row.
async function create({ manager_id, message, scope, urgency, status, send_time, sent_at }) {
  const result = await query(
    `INSERT INTO notifications (manager_id, message, scope, urgency, status, send_time, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [manager_id, message, scope, urgency, status, send_time, sent_at]
  );
  return result.rows[0];
}

// Resolve a scope to the concrete recipient user ids plus the Socket.IO rooms to
// emit to. Rooms mirror the auto-joins in config/socket.js.
async function resolveRecipients(scope) {
  if (scope.type === 'blocks') {
    const { rows } = await query(
      `SELECT id FROM users
       WHERE role = 'resident' AND status = 'active' AND block_number = ANY($1)`,
      [scope.blocks]
    );
    return {
      userIds: rows.map((r) => r.id),
      rooms: scope.blocks.map((b) => `block-${b}`),
    };
  }

  if (scope.type === 'all_blocks') {
    const { rows } = await query(
      `SELECT id, block_number FROM users
       WHERE role = 'resident' AND status = 'active' AND block_number IS NOT NULL`
    );
    const rooms = [...new Set(rows.map((r) => `block-${r.block_number}`))];
    return { userIds: rows.map((r) => r.id), rooms };
  }

  if (scope.type === 'contractor') {
    return {
      userIds: [scope.contractor_user_id],
      rooms: [`contractor-${scope.contractor_user_id}`],
    };
  }

  if (scope.type === 'inspector_team') {
    const { rows } = await query(
      `SELECT id FROM users WHERE role = 'inspector' AND status = 'active'`
    );
    return { userIds: rows.map((r) => r.id), rooms: ['inspector-team'] };
  }

  return { userIds: [], rooms: [] };
}

// Bulk-insert one recipient row per user id. delivered = TRUE because the caller
// emits to the target rooms right after; offline recipients still fetch unread
// rows on next login. Ignores duplicates (UNIQUE notification_id + resident_id).
async function addRecipients(notificationId, userIds) {
  if (userIds.length === 0) return;
  await query(
    `INSERT INTO notification_recipients (notification_id, resident_id, delivered)
     SELECT $1, uid, TRUE FROM unnest($2::uuid[]) AS uid
     ON CONFLICT (notification_id, resident_id) DO NOTHING`,
    [notificationId, userIds]
  );
}

// Scheduled notifications whose send_time has arrived — the dispatcher polls this.
async function findDueScheduled() {
  const { rows } = await query(
    `SELECT * FROM notifications
     WHERE status = 'Scheduled' AND send_time <= NOW()`
  );
  return rows;
}

// Flip a scheduled notification to Sent once dispatched.
async function markSent(id) {
  const { rows } = await query(
    `UPDATE notifications SET status = 'Sent', sent_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

// Mark one recipient's row read. Returns the updated row, or undefined if this
// user was not a recipient of the notification.
async function markRead(notificationId, userId) {
  const { rows } = await query(
    `UPDATE notification_recipients SET read = TRUE, read_at = NOW()
     WHERE notification_id = $1 AND resident_id = $2
     RETURNING *`,
    [notificationId, userId]
  );
  return rows[0];
}

// Read-receipt totals for a notification (UC-008 live count).
async function getReceiptCounts(id) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE read)::int AS read_count
     FROM notification_recipients WHERE notification_id = $1`,
    [id]
  );
  const { total, read_count } = rows[0];
  return { total, read_count, unread_count: total - read_count };
}

module.exports = {
  create,
  resolveRecipients,
  addRecipients,
  findDueScheduled,
  markSent,
  markRead,
  getReceiptCounts,
};
