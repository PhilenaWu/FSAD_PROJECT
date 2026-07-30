// DB queries for notifications + notification_recipients (UC-008). Raw SQL via
// the shared pg pool, following inspectionModel.js style.
//
// scope shape — manager broadcasts (validated in the controller):
//   { type: 'blocks', blocks: ['44A','44B'] } — residents in those blocks
//   { type: 'all_blocks' }                    — all residents
//   { type: 'contractor', contractor_user_id } — one contractor account
//   { type: 'inspector_team' }                — all inspectors
//
// scope shape — system events (notificationService.notifyEvent, migration 035):
//   { type: 'managers' }                      — all active managers
//   { type: 'admins' }                        — all active admins
//   { type: 'users', user_ids: [...], rooms: [...] }
//                                             — named individuals; the caller
//                                               supplies rooms because a user's
//                                               room depends on their role
'use strict';

const { query } = require('../config/db');

// Insert a notifications row. `status`/`send_time`/`sent_at` are supplied by the
// caller: immediate sends pass status 'Sent' + sent_at; scheduled sends pass
// status 'Scheduled' + send_time and leave sent_at NULL. Returns the row.
//
// `event_type` and `link` (migration 035) are optional and stay NULL for manager
// broadcasts — a NULL event_type is what marks a row as human-authored.
async function create({
  manager_id,
  message,
  scope,
  urgency,
  status,
  send_time,
  sent_at,
  event_type,
  link,
}) {
  const result = await query(
    `INSERT INTO notifications
       (manager_id, message, scope, urgency, status, send_time, sent_at, event_type, link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [manager_id, message, scope, urgency, status, send_time, sent_at, event_type, link]
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

  // --- System scopes (migration 035). Used by notificationService.notifyEvent. ---

  if (scope.type === 'managers') {
    const { rows } = await query(
      `SELECT id FROM users WHERE role = 'manager' AND status = 'active'`
    );
    return { userIds: rows.map((r) => r.id), rooms: ['manager-room'] };
  }

  if (scope.type === 'admins') {
    const { rows } = await query(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active'`
    );
    return { userIds: rows.map((r) => r.id), rooms: ['admin-room'] };
  }

  // Named individuals — "the contractor on this record", "the inspector who
  // raised it", "the resident who filed it". Ids are verified against `users`
  // rather than trusted, because they land in an FK column: an unknown or
  // already-deleted id would otherwise fail the recipient insert and lose the
  // whole notification. Rooms are supplied by the caller since a user's room
  // name depends on their role (contractor-{id} vs block-{n}).
  if (scope.type === 'users') {
    const ids = (scope.user_ids ?? []).filter(Boolean);
    if (ids.length === 0) return { userIds: [], rooms: [] };
    const { rows } = await query(
      `SELECT id FROM users WHERE id = ANY($1) AND status = 'active'`,
      [ids]
    );
    return { userIds: rows.map((r) => r.id), rooms: scope.rooms ?? [] };
  }

  return { userIds: [], rooms: [] };
}

// A recipient's own notifications, newest first — the persisted inbox behind
// GET /api/notifications. Without this the bell was memory-only: anything that
// arrived while the user was offline (or before a refresh) was unreachable,
// even though the recipient row existed all along.
async function findForRecipient(userId, { unread_only = false, limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT n.id, n.message, n.urgency, n.event_type, n.link, n.created_at,
            r.read, r.read_at
     FROM notification_recipients r
     JOIN notifications n ON n.id = r.notification_id
     WHERE r.resident_id = $1
       AND ($2::boolean = FALSE OR r.read = FALSE)
     ORDER BY n.created_at DESC
     LIMIT $3`,
    [userId, unread_only, limit]
  );
  return rows;
}

// Unread count for the bell badge, independent of the page size above.
async function countUnreadForRecipient(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS unread
     FROM notification_recipients
     WHERE resident_id = $1 AND read = FALSE`,
    [userId]
  );
  return rows[0]?.unread ?? 0;
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

// Take a scheduled notification out of the dispatch queue after a failed send.
// findDueScheduled() matches on status = 'Scheduled', so without this a send
// that can never succeed is retried every 60 s forever. 'Failed' is already in
// the migration 012 CHECK constraint; nothing had ever set it.
async function markFailed(id) {
  const { rows } = await query(
    `UPDATE notifications SET status = 'Failed'
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
  markFailed,
  markRead,
  getReceiptCounts,
  findForRecipient,
  countUnreadForRecipient,
};
