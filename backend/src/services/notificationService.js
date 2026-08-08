// Notification delivery (UC-008). Two entry points over one code path:
//
//   deliver(notification)  — an existing notifications row goes out. Used by the
//                            manager broadcast and by the scheduled dispatcher.
//   notifyEvent({...})     — a lifecycle transition creates a durable
//                            notification and sends it in one call.
//
// Why notifyEvent exists: before it, the only thing that ever produced a
// notification was a manager typing a broadcast. Lifecycle transitions emitted
// `status_update` sockets instead, which are transient — they refresh a page
// that happens to be open and then vanish, so anyone offline never learned the
// event happened. notifyEvent writes the row *and* emits, so a system event
// behaves exactly like a broadcast: persisted, unread-badged, mark-readable.
'use strict';

const notificationModel = require('../models/notificationModel');
const socketService = require('../services/socketService');

// Resolve recipients, persist the recipient rows, and emit to every target room.
// Returns the recipient count.
async function deliver(notification) {
  const { userIds, rooms } = await notificationModel.resolveRecipients(notification.scope);
  await notificationModel.addRecipients(notification.id, userIds);

  // The live payload must carry what the persisted inbox already returns, or
  // a message shows its sender only after a refresh. NULL for a lifecycle
  // event — nobody wrote it — which the bell renders as "System".
  const sender = await notificationModel.findSender(notification.manager_id);

  socketService.emitToRooms(rooms, 'notification', {
    id: notification.id,
    message: notification.message,
    urgency: notification.urgency,
    event_type: notification.event_type,
    link: notification.link,
    created_at: notification.created_at,
    sender_name: sender.full_name ?? null,
    sender_role: sender.role ?? null,
  });

  return userIds.length;
}

// The seam every lifecycle transition calls. `scope` takes the same shapes the
// manager broadcast uses plus the system ones (see notificationModel.resolveRecipients).
//
// Deliberately never throws (G13): a notification is a side effect of a state
// change that has already committed, so a failed insert or a dead socket must
// not turn a successful transition into a 500. Failures are logged and swallowed,
// matching how dispatchDueNotifications already tolerates one bad send.
//
// `manager_id` is null — these rows have no human author.
async function notifyEvent({ event_type, scope, message, urgency = 'Informational', link }) {
  try {
    const notification = await notificationModel.create({
      manager_id: null,
      message,
      scope,
      urgency,
      status: 'Sent',
      send_time: null,
      sent_at: new Date(),
      event_type,
      link,
    });
    return await deliver(notification);
  } catch (err) {
    console.error(`[notifications] Event '${event_type}' failed to notify:`, err.message);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Trigger register. Every call site is additive — a notifyEvent() beside an
// existing emit — and no existing socket emit, email or control flow was
// changed to add any of them.
//
//   inspectionController.js   defects_flagged (managers + assignee, Critical if
//                             any defect is Critical) · spot_check_passed ·
//                             complaint_submitted · defect_assigned ·
//                             priority_changed · rectification_rejected ·
//                             closed (managers + admins + originator) ·
//                             defect_email_failed
//   contractorController.js   acknowledged · on_hold · resumed (each ONE
//                             notification to managers + the record's
//                             inspector, via the managers_and_users scope — see
//                             D.12/D.15 below) · rectified + review_requested
//                             (item 17: the managers get the notice, the
//                             record's inspector gets the task. Two rows, but
//                             to audiences that are disjoint by role, so no
//                             recipient is written twice — the thing D.12 was
//                             actually about)
//   myReportsController.js    rating_submitted
//   cvController.js           cv_detection
//   vendorController.js       vendor_onboarded · vendor_renewed ·
//                             vendor_suspended · vendor_expired ·
//                             vendor_expiring_soon
//   reportController.js       report_ready
//   recommendationController  ai_alerts_generated
//
// Deliberately NOT notified:
//   • 'Work Progress Saved' (contractor partial save) — HLD §10 gives it no
//     email, and a durable row per save would bury the bell.
//   • Manager-initiated CV actions (createTicketFromDetection, dismiss) —
//     telling someone about their own click is noise.
//   • The resident who filed a complaint, on a contractor-side transition
//     (D.15). Those go to managers + the inspector only. The old resident branch
//     addressed `block-{n}`, a room holding every resident of the block, so a
//     socket notification about one household's defect reached all of their
//     neighbours while only the originator got a durable row. Residents still
//     see live status on /my-reports.
//
// Still open, and owned elsewhere:
//   • D.5 (Philena) — the status_update emits for assign (~:487) and reject
//     (~:723) still omit `contractor-{user_id}`. The notifications above reach
//     the contractor regardless, so this is now cosmetic for live page refresh
//     rather than a delivery hole, but the room list is still wrong.
//   • Overdue chase (Davian, D.7) — event_type 'overdue_chase' → the contractor
//     + managers. No handler and no defect_email_log table exist yet.
//   • retryQueueModel.markFailed (Mahdiya) — a Roboflow scan that gives up
//     after its 429 retries is still invisible to everyone. Left alone because
//     it needs a call site inside the model, not a controller.
//
// (UC-010 Alt A / G11 is no longer a gap: inspectionModel.resumeByContractor
// writes `Resumed` and extends target_deadline by the held duration.)
//
// TEST GAP — the trigger call sites above are not covered. notifications.test.js
// covers the delivery seam (notifyEvent, scope resolution, the inbox, the
// dispatcher's Failed path) but nothing asserts that a given transition raises a
// given event. These belong in tests/integration/inspections.integration.test.js
// and tests/unit/contractor.test.js, which already drive the real routes against
// their own fixtures — deliberately NOT written against mocked models here, so
// they exercise the real controller/model flow. To assert once those suites are
// free to extend:
//   • defect submit → managers AND the assigned contractor's room
//   • a Critical defect escalates urgency to Critical
//   • zero defects → managers only, no contractor involved (G6)
//   • an invalid submission (INCOMPLETE_CHECKLIST) notifies nobody
//   • reject → contractor-{user_id}, message quotes the reason
//   • acknowledge → managers + the originator (inspector-team, or block-{n} and
//     a /my-reports link when the originator is a resident)
//   • a partial save (finalize=false) notifies nobody
// ---------------------------------------------------------------------------

module.exports = { deliver, notifyEvent };
