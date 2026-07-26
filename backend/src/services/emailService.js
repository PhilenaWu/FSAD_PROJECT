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

module.exports = { sendReportEmail };
