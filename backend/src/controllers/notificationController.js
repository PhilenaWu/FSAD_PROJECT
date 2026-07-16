// Notification controllers (UC-008). A manager sends or schedules a scoped
// message; recipients receive it live over Socket.IO and can mark it read.
// dispatchDueNotifications() is internal — called by notificationDispatcher.js
// on a timer, not exposed as a route.
'use strict';

const notificationModel = require('../models/notificationModel');
const socketService = require('../services/socketService');

const URGENCIES = ['Informational', 'Warning', 'Critical'];

// Validate the scope object shape. Returns an error string, or null if valid.
function validateScope(scope) {
  if (!scope || typeof scope !== 'object') return 'scope is required.';
  switch (scope.type) {
    case 'blocks':
      if (!Array.isArray(scope.blocks) || scope.blocks.length === 0) {
        return 'scope.blocks must be a non-empty array.';
      }
      return null;
    case 'all_blocks':
    case 'inspector_team':
      return null;
    case 'contractor':
      if (!scope.contractor_user_id) return 'scope.contractor_user_id is required.';
      return null;
    default:
      return 'scope.type must be blocks, all_blocks, contractor or inspector_team.';
  }
}

// Resolve recipients, persist the recipient rows, and emit the notification to
// every target room. Shared by immediate send and scheduled dispatch.
async function deliver(notification) {
  const { userIds, rooms } = await notificationModel.resolveRecipients(notification.scope);
  await notificationModel.addRecipients(notification.id, userIds);

  socketService.emitToRooms(rooms, 'notification', {
    id: notification.id,
    message: notification.message,
    urgency: notification.urgency,
    created_at: notification.created_at,
  });

  return userIds.length;
}

// POST /api/notifications — manager sends or schedules a notification.
async function send(req, res, next) {
  try {
    const manager_id = req.user.id;
    const { message, scope, urgency, send_time } = req.body;

    // Inline validation (the codebase doesn't use joi/zod).
    if (!message || message.length > 500) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'message is required and must be 500 characters or fewer.',
      });
    }
    if (!URGENCIES.includes(urgency)) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'urgency must be Informational, Warning or Critical.',
      });
    }
    const scopeError = validateScope(scope);
    if (scopeError) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: scopeError });
    }

    // A send_time in the future defers the broadcast to the dispatcher; blank or
    // past means send now.
    const scheduled = send_time && new Date(send_time) > new Date();

    const notification = await notificationModel.create({
      manager_id,
      message,
      scope,
      urgency,
      status: scheduled ? 'Scheduled' : 'Sent',
      send_time: scheduled ? send_time : null,
      sent_at: scheduled ? null : new Date(),
    });

    if (scheduled) {
      return res.status(201).json({
        notification_id: notification.id,
        status: 'Scheduled',
        send_time: notification.send_time,
      });
    }

    const recipients_count = await deliver(notification);
    res.status(201).json({
      notification_id: notification.id,
      status: 'Sent',
      recipients_count,
      sent_at: notification.sent_at,
    });
  } catch (err) {
    next(err);
  }
}

// Internal: dispatch every scheduled notification whose time has arrived. Called
// by notificationDispatcher.js on a 60 s timer. Each notification is delivered
// then flipped to Sent; one failure doesn't abort the others.
async function dispatchDueNotifications() {
  const due = await notificationModel.findDueScheduled();
  for (const notification of due) {
    try {
      await deliver(notification);
      await notificationModel.markSent(notification.id);
    } catch (err) {
      console.error(`[notifications] Failed to dispatch ${notification.id}:`, err.message);
    }
  }
  return due.length;
}

// GET /api/notifications/:id/receipts — manager reads live read/unread counts.
async function getReceipts(req, res, next) {
  try {
    const counts = await notificationModel.getReceiptCounts(req.params.id);
    res.json({
      notification_id: req.params.id,
      total_recipients: counts.total,
      read_count: counts.read_count,
      unread_count: counts.unread_count,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/:id/read — a recipient marks the notification read.
async function markRead(req, res, next) {
  try {
    const row = await notificationModel.markRead(req.params.id, req.user.id);
    if (!row) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'You are not a recipient of this notification.',
      });
    }
    res.json({ notification_id: req.params.id, read: true, read_at: row.read_at });
  } catch (err) {
    next(err);
  }
}

module.exports = { send, dispatchDueNotifications, getReceipts, markRead };
