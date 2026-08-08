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
//   { type: 'managers_and_users', user_ids: [...], rooms: [...] }
//   { type: 'managers_and_inspectors' }        — the only scope a contractor
//                                                may send to (item 16b)
//                                             — managers ∪ named individuals,
//                                               deduped; one row for an event
//                                               with two staff audiences
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

  // All active managers PLUS named individuals — "the managers and the inspector
  // on this record". One scope rather than two notifyEvent calls, so a single
  // transition writes a single row and nobody who falls in both sets sees the
  // event twice (D.12). Ids are union-deduped before they reach the recipient
  // insert, which is what makes the overlap impossible rather than merely
  // unlikely. Named ids are verified against `users` for the same reason as the
  // 'users' scope below.
  if (scope.type === 'managers_and_users') {
    const ids = (scope.user_ids ?? []).filter(Boolean);
    const [managers, named] = await Promise.all([
      query(`SELECT id FROM users WHERE role = 'manager' AND status = 'active'`),
      ids.length
        ? query(`SELECT id FROM users WHERE id = ANY($1) AND status = 'active'`, [ids])
        : Promise.resolve({ rows: [] }),
    ]);
    const userIds = [...new Set([...managers.rows, ...named.rows].map((r) => r.id))];
    const rooms = [...new Set(['manager-room', ...(scope.rooms ?? [])])];
    return { userIds, rooms };
  }

  // Every active manager and inspector — the only audience a contractor may
  // address (item 16b). A contractor on site reports upwards, so this is a
  // fixed scope with nothing for the sender to choose: no blocks, no named
  // individuals, and therefore no way to reach a resident. Roles are unioned in
  // one query since neither set is named by the caller.
  if (scope.type === 'managers_and_inspectors') {
    const { rows } = await query(
      `SELECT id FROM users
       WHERE role IN ('manager', 'inspector') AND status = 'active'`
    );
    return { userIds: rows.map((r) => r.id), rooms: ['manager-room', 'inspector-team'] };
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
            r.read, r.read_at,
            -- Who wrote it. NULL for a lifecycle event (manager_id is NULL on
            -- those, migration 035), which is what lets the bell say "System"
            -- for an automatic message and name the person for a human one.
            u.full_name AS sender_name, u.role AS sender_role
     FROM notification_recipients r
     JOIN notifications n ON n.id = r.notification_id
     LEFT JOIN users u ON u.id = n.manager_id
     WHERE r.resident_id = $1
       AND ($2::boolean = FALSE OR r.read = FALSE)
     ORDER BY n.created_at DESC
     LIMIT $3`,
    [userId, unread_only, limit]
  );
  return rows;
}

// The author of a notification, for the live socket payload — the stored row
// carries only manager_id, and a recipient needs a name. Returns {} for a
// lifecycle event, whose manager_id is NULL because no human wrote it.
async function findSender(userId) {
  if (!userId) return {};
  const { rows } = await query(
    `SELECT full_name, role FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? {};
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

// A manager's own outbox, newest first — the history behind
// GET /api/notifications/sent. Receipt counts are joined in one query rather
// than polled per row, because the history lists many notifications at once and
// the per-notification /receipts endpoint is built for watching a single send.
//
// System events (manager_id IS NULL) are deliberately excluded: this is "what I
// sent", not an audit log of every lifecycle notification the server raised.
async function findByManager(managerId, { limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT n.id, n.message, n.urgency, n.scope, n.status,
            n.send_time, n.sent_at, n.created_at,
            COUNT(r.*)::int AS total_recipients,
            COUNT(r.*) FILTER (WHERE r.read)::int AS read_count
     FROM notifications n
     LEFT JOIN notification_recipients r ON r.notification_id = n.id
     WHERE n.manager_id = $1
     GROUP BY n.id
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [managerId, limit]
  );
  return rows;
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
  findByManager,
  findSender,
};
