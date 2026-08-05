// UC-009 report email delivery via Nodemailer. Sends the manager/admin a
// professional email with a link to the generated PDF report. SMTP transport is
// configured from the SMTP_* env vars. Throws if sending fails — the report
// orchestrator catches that so a failed email never fails the report itself.
'use strict';

const nodemailer = require('nodemailer');
const config = require('../config/env');

// Build the SMTP transport from env. Created per send so config changes and
// tests (which mock this module) don't hold a stale connection.
function getTransport() {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT || 587,
    secure: false, // STARTTLS on 587
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
}

/**
 * Send the monthly report email with a link to the Cloudinary-hosted PDF.
 *
 * @param {string} reportUrl - secure URL of the uploaded PDF report.
 * @param {string} periodLabel - human-readable period, e.g. '2026-06-24 to 2026-07-24'.
 * @param {string} recipientEmail - recipient address(es); comma-separated for many.
 * @returns {Promise<void>} resolves when the message is accepted by the SMTP server.
 * @throws {Error} if SMTP delivery fails (propagated from nodemailer).
 */
async function sendReportEmail(reportUrl, periodLabel, recipientEmail) {
  const subject = `Monthly Estate Report — ${periodLabel}`;
  const text =
    `The monthly estate maintenance report for ${periodLabel} is ready.\n\n` +
    `View or download the PDF here: ${reportUrl}\n\n` +
    `This is an automated message from EM Services.`;
  const html =
    `<p>The monthly estate maintenance report for <strong>${periodLabel}</strong> is ready.</p>` +
    `<p><a href="${reportUrl}">View or download the PDF report</a></p>` +
    `<p style="color:#888;font-size:12px">This is an automated message from EM Services.</p>`;

  await getTransport().sendMail({
    from: config.SMTP_USER,
    to: recipientEmail,
    subject,
    text,
    html,
  });
}

// Deep link to the contractor's own queue (D.2). Falls back to a bare path when
// FRONTEND_URL isn't configured, so the email still says where to go.
function contractorInboxLink() {
  const base = (config.FRONTEND_URL || '').replace(/\/+$/, '');
  return `${base}/contractor-inbox`;
}

// Render the failed checkpoints as plain text and as an HTML table (D.2: section,
// item no., text, severity, remark). Photos are Cloudinary links, NEVER
// attachments — HLD §10 is explicit, and a 25-photo form would bounce on size.
// Returns { text, html }, both empty strings when there are no defects to list.
function renderDefectTable(defects) {
  if (!Array.isArray(defects) || defects.length === 0) {
    return { text: '', html: '' };
  }

  const text =
    `\nFailed checkpoints (${defects.length}):\n` +
    defects
      .map((d) => {
        const parts = [
          `  ${d.item_no}. [${d.section}] ${d.item_text}`,
          `     Severity: ${d.severity ?? 'not recorded'}`,
        ];
        if (d.remark) parts.push(`     Remark: ${d.remark}`);
        if (d.photo_url) parts.push(`     Photo: ${d.photo_url}`);
        return parts.join('\n');
      })
      .join('\n') +
    '\n';

  const html =
    `<p><strong>Failed checkpoints (${defects.length})</strong></p>` +
    `<table cellpadding="4" border="1" style="border-collapse:collapse">` +
    `<tr><th>#</th><th>Section</th><th>Checkpoint</th><th>Severity</th>` +
    `<th>Remark</th><th>Photo</th></tr>` +
    defects
      .map(
        (d) =>
          `<tr><td>${d.item_no}</td><td>${d.section}</td><td>${d.item_text}</td>` +
          `<td>${d.severity ?? '—'}</td><td>${d.remark ?? '—'}</td>` +
          `<td>${d.photo_url ? `<a href="${d.photo_url}">view</a>` : '—'}</td></tr>`
      )
      .join('') +
    `</table>`;

  return { text, html };
}

/**
 * Send a defect email to the contractor (LC). Fired from the spot-check submit
 * (D.3), the assign path (UC-002), the rejection path (UC-004 Alt 4), and the
 * daily overdue chase (D.7). Failures are swallowed by the caller so a mail
 * hiccup never blocks the underlying action (G13).
 *
 * `email_type` selects the UC-014 variant:
 *   - 'defect_alert' (default) — the defect has just been raised or assigned.
 *     When `defects` is supplied this is a spot-check alert and takes the D.2
 *     subject naming the block, lift and defect count.
 *   - 'rejection'     — the manager refused the rectification, so the same defect
 *     is back on a fresh deadline. Quotes the reason (UC-014 A2).
 *   - 'overdue_chase' — D−3 or past due; wording depends on `days_remaining`.
 *
 * @param {Object} defect - the inspection row.
 * @param {string} defect.title
 * @param {string} defect.category
 * @param {string} defect.priority
 * @param {string} defect.location_block
 * @param {string} [defect.location_unit]
 * @param {string} [defect.description]
 * @param {string} [defect.target_deadline] - ISO timestamp of the deadline.
 * @param {string} recipientEmail - recipient address(es); comma-separated for many.
 * @param {Object} [options]
 * @param {'defect_alert'|'rejection'|'overdue_chase'} [options.email_type='defect_alert']
 * @param {string} [options.reason] - rejection reason; quoted for 'rejection'.
 * @param {Object[]} [options.defects] - failed checkpoints: { section, item_no,
 *   item_text, severity, remark, photo_url }. Presence switches the defect_alert
 *   subject to the D.2 spot-check form.
 * @param {string} [options.lift_code] - named in the spot-check subject.
 * @param {number} [options.days_remaining] - negative once overdue; used by
 *   'overdue_chase' to word the reminder.
 * @returns {Promise<void>} resolves when the message is accepted by the SMTP server.
 * @throws {Error} if SMTP delivery fails (propagated from nodemailer).
 */
async function sendDefectAlert(defect, recipientEmail, options = {}) {
  const {
    email_type = 'defect_alert',
    reason,
    defects = [],
    lift_code,
    days_remaining,
  } = options;
  const isRejection = email_type === 'rejection';
  const isChase = email_type === 'overdue_chase';
  // A spot-check alert carries its failed checkpoints; a resident complaint
  // assigned from the triage queue has none, and keeps the generic wording.
  const isSpotCheck = !isRejection && !isChase && defects.length > 0;

  const location = defect.location_unit
    ? `Block ${defect.location_block}, Unit ${defect.location_unit}`
    : `Block ${defect.location_block}`;
  const deadline = defect.target_deadline
    ? new Date(defect.target_deadline).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : 'not set';
  const overdueBy = Number(days_remaining);
  const isPastDue = Number.isFinite(overdueBy) && overdueBy < 0;

  let subject;
  let lead;
  if (isRejection) {
    subject = `Rectification Rejected — ${defect.title} (${location})`;
    lead =
      'Your rectification of the defect below was not accepted, and the defect ' +
      'has been re-opened for you to action again.';
  } else if (isChase) {
    subject = isPastDue
      ? `[Overdue] ${defect.title} (${location}) — ${Math.abs(overdueBy)} day(s) past deadline`
      : `[Due Soon] ${defect.title} (${location}) — due ${deadline}`;
    lead = isPastDue
      ? `This defect passed its rectification deadline ${Math.abs(overdueBy)} day(s) ago and is still open. Please rectify and submit your completion proof.`
      : `This defect is due for rectification on ${deadline}. Please complete it before the deadline.`;
  } else if (isSpotCheck) {
    // D.2 subject: the supervisor should be able to triage from the subject line
    // alone, without opening the mail.
    subject =
      `[Spot-Check Defect] Blk ${defect.location_block}` +
      `${lift_code ? ` Lift ${lift_code}` : ''} — ` +
      `${defects.length} defect(s), due ${deadline}`;
    lead =
      `A lift spot-check recorded ${defects.length} defect(s) on equipment you ` +
      `service. The failed checkpoints are listed below for rectification.`;
  } else {
    subject = `Defect Assigned — ${defect.title} (${location})`;
    lead = 'A defect has been assigned to you for rectification.';
  }

  const deadlineLabel = isRejection ? 'New deadline' : 'Deadline';
  const deadlineTextLabel = isRejection
    ? 'New rectification deadline'
    : 'Rectification deadline';
  const table = renderDefectTable(defects);
  const link = contractorInboxLink();

  const text =
    `${lead}\n\n` +
    `Title: ${defect.title}\n` +
    `Category: ${defect.category}\n` +
    `Priority: ${defect.priority}\n` +
    `Location: ${location}\n` +
    (lift_code ? `Lift: ${lift_code}\n` : '') +
    `${deadlineTextLabel}: ${deadline}\n` +
    (isRejection && reason ? `\nReason for rejection: ${reason}\n` : '') +
    (defect.description ? `\nDetails: ${defect.description}\n` : '') +
    table.text +
    // The two-week rule, stated in the mail so it is not something the
    // contractor has to remember or look up.
    (isSpotCheck ? '\nRectification is due within 2 weeks of this notice.\n' : '') +
    `\nAcknowledge and action this defect here: ${link}\n`;
  const html =
    `<p>${lead}</p>` +
    (isRejection && reason
      ? `<p><strong>Reason for rejection:</strong> ${reason}</p>`
      : '') +
    `<table cellpadding="4" style="border-collapse:collapse">` +
    `<tr><td><strong>Title</strong></td><td>${defect.title}</td></tr>` +
    `<tr><td><strong>Category</strong></td><td>${defect.category}</td></tr>` +
    `<tr><td><strong>Priority</strong></td><td>${defect.priority}</td></tr>` +
    `<tr><td><strong>Location</strong></td><td>${location}</td></tr>` +
    (lift_code ? `<tr><td><strong>Lift</strong></td><td>${lift_code}</td></tr>` : '') +
    `<tr><td><strong>${deadlineLabel}</strong></td><td>${deadline}</td></tr>` +
    `</table>` +
    (defect.description ? `<p><strong>Details:</strong> ${defect.description}</p>` : '') +
    table.html +
    (isSpotCheck
      ? '<p>Rectification is due within <strong>2 weeks</strong> of this notice.</p>'
      : '') +
    `<p><a href="${link}">Acknowledge and action this defect</a></p>` +
    `<p style="color:#888;font-size:12px">This is an automated message from EM Services.</p>`;

  await getTransport().sendMail({
    from: config.SMTP_USER,
    to: recipientEmail,
    subject,
    text,
    html,
  });
}

module.exports = { sendReportEmail, sendDefectAlert };
