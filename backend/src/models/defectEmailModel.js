// DB queries for the UC-014 outbound defect email: the defect_email_log audit
// table (migration 036), the inspections.defect_email_sent_at replay guard, and
// the records the daily overdue chase (D.7) is due to remind about.
//
// Raw parameterised SQL via the shared pg pool — no ORM, same style as
// inspectionModel.js. Grouped here rather than in inspectionModel because every
// query belongs to the email side of UC-014, not to the inspection lifecycle.
'use strict';

const { query } = require('../config/db');
const { onHoldSql } = require('../utils/onHold');

// Recipient recorded when there is nobody to email (UC-014 A4). `recipient` is
// NOT NULL, and a sentinel keeps the failure auditable rather than unloggable.
const NO_RECIPIENT = '(no contact email)';

/**
 * Append a defect_email_log row — auditable proof of an attempted send.
 *
 * Both outcomes are logged: 'sent' on delivery, 'failed' with the error when the
 * SMTP call throws or there was nobody to send to (A4). The manager's delivery
 * chip (P.15) reads these rows.
 *
 * @param {Object} entry
 * @param {string} entry.inspection_id
 * @param {string} entry.contractor_id - required by the schema; callers skip the
 *   log entirely when a record has no contractor at all.
 * @param {string} [entry.recipient] - address(es) written to; defaults to the
 *   A4 sentinel when absent.
 * @param {'defect_alert'|'reassignment'|'overdue_chase'|'rejection'} entry.email_type
 * @param {'sent'|'failed'} [entry.status='sent']
 * @param {string} [entry.error_message] - failure detail; NULL on success.
 * @returns {Promise<Object>} the created row.
 * @throws {Error} if the insert fails (propagated from pg).
 */
async function logEmail({
  inspection_id,
  contractor_id,
  recipient,
  email_type,
  status = 'sent',
  error_message = null,
}) {
  const { rows } = await query(
    `INSERT INTO defect_email_log
       (inspection_id, contractor_id, recipient, email_type, status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      inspection_id,
      contractor_id,
      recipient || NO_RECIPIENT,
      email_type,
      status,
      error_message,
    ]
  );
  return rows[0];
}

/**
 * Stamp inspections.defect_email_sent_at so a replay of the same submit cannot
 * send a second alert (G12). Only set on a successful send.
 *
 * @param {string} inspectionId
 * @returns {Promise<void>}
 * @throws {Error} if the update fails (propagated from pg).
 */
async function markDefectEmailSent(inspectionId) {
  await query(
    'UPDATE inspections SET defect_email_sent_at = NOW() WHERE id = $1',
    [inspectionId]
  );
}

/**
 * Has an email of this type already gone out for this record today?
 *
 * The chase job runs daily and must remind at most once per record per day, so
 * a re-run (or a manual workflow_dispatch on the same day) is a no-op. Compared
 * on calendar date rather than a 24-hour window: two runs either side of
 * midnight are two different days, which is what "once per day" means to the
 * contractor receiving them.
 *
 * @param {string} inspectionId
 * @param {string} emailType
 * @returns {Promise<boolean>}
 * @throws {Error} if the query fails (propagated from pg).
 */
async function sentToday(inspectionId, emailType) {
  const { rows } = await query(
    `SELECT 1 FROM defect_email_log
      WHERE inspection_id = $1
        AND email_type = $2
        AND status = 'sent'
        AND sent_at::date = CURRENT_DATE
      LIMIT 1`,
    [inspectionId, emailType]
  );
  return rows.length > 0;
}

/**
 * Records the overdue chase is due to remind about (D.7): still with the
 * contractor and either 3 days from the deadline or already past it.
 *
 * Only `Assigned` / `Acknowledged` qualify — a `Rectified` record is waiting on
 * the inspector, not the contractor, so chasing it would be wrong. ('Acknowledged'
 * is no longer set by anything; it stays here for records that still carry it.)
 * Held records are excluded because a hold pauses the rectification clock (G11)
 * and the dashboard's overdue count excludes them too; chasing a held record
 * would make the emails contradict the UI. A hold is an audit-trail fact rather
 * than a status now, so that exclusion comes from onHoldSql. Closed records
 * carry is_deleted = TRUE and are excluded by the status filter already.
 *
 * Fires at D−3 and from D+0 onward (HLD §6.2: "3 days out or already past"),
 * deliberately not on D−2 or D−1 — the contractor gets one warning and then
 * daily pressure once it is actually late, rather than a four-day countdown.
 * The per-day guard in sentToday() stops a re-run duplicating any of them.
 *
 * days_remaining is negative once the deadline has passed, so the caller can
 * word the reminder as "due in 3 days" or "overdue by N days" without
 * re-deriving the arithmetic.
 *
 * @returns {Promise<Object[]>} rows with the record, its contractor's contact
 *   details, the lift code, and days_remaining. Soonest deadline first.
 * @throws {Error} if the query fails (propagated from pg).
 */
async function findDueForChase() {
  const { rows } = await query(
    `SELECT i.id,
            i.title,
            i.category,
            i.priority,
            i.status,
            i.location_block,
            i.location_unit,
            i.description,
            i.target_deadline,
            i.contractor_id,
            -- The chase goes to the account holder who can action it, not the
            -- company alias; see CONTRACTOR_RECIPIENT_SQL in inspectionController.
            COALESCE(u.email, c.contact_email) AS contact_email,
            c.user_id  AS contractor_user_id,
            c.name     AS contractor_name,
            l.lift_code,
            (i.target_deadline::date - CURRENT_DATE) AS days_remaining
       FROM inspections i
       JOIN contractors c ON c.id = i.contractor_id
       LEFT JOIN users u  ON u.id = c.user_id AND u.status = 'active'
       LEFT JOIN lifts l  ON l.id = i.lift_id
      WHERE i.status IN ('Assigned', 'Acknowledged')
        AND NOT ${onHoldSql('i')}
        AND i.target_deadline IS NOT NULL
        AND (
          (i.target_deadline::date - CURRENT_DATE) = 3
          OR (i.target_deadline::date - CURRENT_DATE) <= 0
        )
      ORDER BY i.target_deadline ASC`
  );
  return rows;
}

/**
 * The defect rows of one spot-check, with their paper-form item number, section
 * and text — the table the UC-014 email body is built from (D.2).
 *
 * @param {string} inspectionId
 * @returns {Promise<Object[]>} defect rows in form order.
 * @throws {Error} if the query fails (propagated from pg).
 */
async function findDefectsForEmail(inspectionId) {
  const { rows } = await query(
    `SELECT t.section,
            t.display_order AS item_no,
            t.item_text,
            r.severity,
            r.remark,
            r.photo_url
       FROM checklist_results r
       JOIN checklist_items t ON t.id = r.checklist_item_id
      WHERE r.inspection_id = $1
        AND r.result = 'Defect'
      ORDER BY t.display_order`,
    [inspectionId]
  );
  return rows;
}

/**
 * Append the UC-015 audit row for an email event — `Defect Alert Sent` (D.3) or
 * `Overdue Reminder Sent` (D.7). Two of the fourteen required actions in
 * USE_CASES §UC-015 exist only here.
 *
 * previous_status and new_status are both the record's current status on purpose:
 * sending mail is not a state transition, but the trail still has to show that it
 * happened and when. actor_id is NULL for cron-driven sends — there is no human
 * author.
 *
 * @param {string} inspectionId
 * @param {string} action - the audit action label.
 * @param {string} status - the record's status at the time of the send.
 * @param {string|null} [actorId=null] - the acting user, or NULL for a cron run.
 * @param {string|null} [note=null]
 * @returns {Promise<void>}
 * @throws {Error} if the insert fails (propagated from pg).
 */
async function logEmailAudit(inspectionId, action, status, actorId = null, note = null) {
  await query(
    `INSERT INTO inspection_history (
       inspection_id, actor_id, action, previous_status, new_status, note
     )
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [inspectionId, actorId, action, status, status, note]
  );
}

module.exports = {
  NO_RECIPIENT,
  logEmail,
  logEmailAudit,
  markDefectEmailSent,
  sentToday,
  findDueForChase,
  findDefectsForEmail,
};
