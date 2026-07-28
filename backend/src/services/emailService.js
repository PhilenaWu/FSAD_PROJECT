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

/**
 * Send a defect-assignment alert to the assigned contractor (LC) when a manager
 * assigns a defect. Fired from the assign path; failures are swallowed by the
 * caller so a mail hiccup never blocks the assignment.
 *
 * @param {Object} defect - the assigned inspection row.
 * @param {string} defect.title
 * @param {string} defect.category
 * @param {string} defect.priority
 * @param {string} defect.location_block
 * @param {string} [defect.location_unit]
 * @param {string} [defect.description]
 * @param {string} [defect.target_deadline] - ISO timestamp of the 14-day deadline.
 * @param {string} recipientEmail - recipient address(es); comma-separated for many.
 * @returns {Promise<void>} resolves when the message is accepted by the SMTP server.
 * @throws {Error} if SMTP delivery fails (propagated from nodemailer).
 */
async function sendDefectAlert(defect, recipientEmail) {
  const location = defect.location_unit
    ? `Block ${defect.location_block}, Unit ${defect.location_unit}`
    : `Block ${defect.location_block}`;
  const deadline = defect.target_deadline
    ? new Date(defect.target_deadline).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : 'not set';

  const subject = `Defect Assigned — ${defect.title} (${location})`;
  const text =
    `A defect has been assigned to you for rectification.\n\n` +
    `Title: ${defect.title}\n` +
    `Category: ${defect.category}\n` +
    `Priority: ${defect.priority}\n` +
    `Location: ${location}\n` +
    `Rectification deadline: ${deadline}\n` +
    (defect.description ? `\nDetails: ${defect.description}\n` : '') +
    `\nPlease acknowledge and action this defect in the EM Services portal.`;
  const html =
    `<p>A defect has been assigned to you for rectification.</p>` +
    `<table cellpadding="4" style="border-collapse:collapse">` +
    `<tr><td><strong>Title</strong></td><td>${defect.title}</td></tr>` +
    `<tr><td><strong>Category</strong></td><td>${defect.category}</td></tr>` +
    `<tr><td><strong>Priority</strong></td><td>${defect.priority}</td></tr>` +
    `<tr><td><strong>Location</strong></td><td>${location}</td></tr>` +
    `<tr><td><strong>Deadline</strong></td><td>${deadline}</td></tr>` +
    `</table>` +
    (defect.description ? `<p><strong>Details:</strong> ${defect.description}</p>` : '') +
    `<p>Please acknowledge and action this defect in the EM Services portal.</p>` +
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
