// UC-009 automated monthly reports — orchestration (Phase 2). Express routes and
// scheduling land in Phase 3; this file exposes the internal orchestrator that a
// route/cron handler will call. The pipeline is:
//   data aggregation -> AI summary -> PDF -> Cloudinary upload -> DB row -> email.
'use strict';

const reportModel = require('../models/reportModel');
const openaiService = require('../services/openaiService');
const pdfService = require('../services/pdfService');
const cloudinaryService = require('../services/cloudinaryService');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');

// Human-readable period for the email subject/body and Cloudinary file name.
function periodLabel(startDate, endDate) {
  return `${String(startDate).slice(0, 10)} to ${String(endDate).slice(0, 10)}`;
}

/**
 * Core report orchestrator. Aggregates the metrics, generates the summary and
 * PDF, uploads the PDF to Cloudinary, persists an audit row, and emails the
 * managers/admins a link.
 *
 * Error handling:
 *  - A Cloudinary upload failure is caught: the row is still saved with
 *    report_status = 'Upload failed' (report_url null) and no email is sent.
 *  - An email failure (or no recipients) is caught: the row stays 'Ready' with
 *    email_delivered = false. A failed email never fails the report.
 *  - Aggregation/PDF errors propagate (no artifact to persist); the Phase 3
 *    route/cron caller wraps this function.
 *
 * @param {string|Date} startDate - inclusive start of the reporting period.
 * @param {string|Date} endDate - exclusive end of the reporting period.
 * @param {'github_actions'|'manual'} triggerSource - what triggered the run;
 *   stored as reports.triggered_by.
 * @returns {Promise<Object>} the persisted reports row (with the final
 *   email_delivered value).
 */
async function generateReportInternal(startDate, endDate, triggerSource) {
  const label = periodLabel(startDate, endDate);

  // 1-3. Data -> summary -> PDF (Phase 1 building blocks).
  const reportData = await reportModel.getReportData(startDate, endDate);
  const summary = await openaiService.generateExecutiveSummary(reportData);
  const pdfBuffer = await pdfService.generateMonthlyReportPDF(reportData, summary);

  // 4. Upload to Cloudinary /reports. On failure, record 'Upload failed' and
  // skip the email — the run still produces an audit row.
  const fileName = `monthly-report-${label.replace(/\s+/g, '-')}`;
  let reportUrl = null;
  let reportStatus = 'Ready';
  try {
    reportUrl = await cloudinaryService.uploadReport(pdfBuffer, fileName);
  } catch (err) {
    console.error('[reportController] Cloudinary upload failed:', err.message);
    reportStatus = 'Upload failed';
  }

  // 5. Persist the audit row.
  const report = await reportModel.createReport({
    report_url: reportUrl,
    period_start: startDate,
    period_end: endDate,
    triggered_by: triggerSource,
    report_status: reportStatus,
    email_delivered: false,
  });

  // In-app copy of the same news. Placed before the email block because that
  // block returns early on success, and a manager who misses the email should
  // still find the report waiting in the bell.
  if (reportStatus === 'Ready' && reportUrl) {
    await notificationService.notifyEvent({
      event_type: 'report_ready',
      scope: { type: 'managers' },
      message: `Monthly report for ${label} is ready.`,
      urgency: 'Informational',
      link: '/reports',
    });
  }

  // 6. Email the managers/admins a link — only when there is a report to link
  // to. Any failure here is swallowed so the report stays 'Ready'.
  if (reportStatus === 'Ready' && reportUrl) {
    try {
      const recipients = await reportModel.getReportRecipients();
      if (recipients.length > 0) {
        await emailService.sendReportEmail(reportUrl, label, recipients.join(','));
        const updated = await reportModel.updateEmailDelivered(report.id, true);
        return updated || { ...report, email_delivered: true };
      }
    } catch (err) {
      console.error('[reportController] Report email failed:', err.message);
    }
  }

  return report;
}

// Half-open [start, end) window for the calendar month before `now` (UTC).
function previousMonthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// Half-open [firstOfThisMonth, now) window — the current month to date (UTC).
function monthToDateRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: start.toISOString(), end: now.toISOString() };
}

/**
 * GET /api/reports/generate — scheduled run (GitHub Actions cron), gated by
 * cronGuard. Generates the report for the previous calendar month.
 * @returns {void} responds 200 with { data: <reports row> }.
 */
async function generateScheduled(req, res, next) {
  try {
    const { start, end } = previousMonthRange();
    const report = await generateReportInternal(start, end, 'github_actions');
    res.json({ data: report });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/reports/generate-manual — manager-triggered run. Uses the supplied
 * { startDate, endDate } body, or the current month to date when omitted.
 * @returns {void} responds 201 with { data: <reports row> }.
 */
async function generateManual(req, res, next) {
  try {
    const { startDate, endDate } = req.body || {};
    const range =
      startDate && endDate ? { start: startDate, end: endDate } : monthToDateRange();
    const report = await generateReportInternal(range.start, range.end, 'manual');
    res.status(201).json({ data: report });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/reports — list past generated reports (archive).
 * @returns {void} responds 200 with { data: [...], total }.
 */
async function listReports(req, res, next) {
  try {
    const rows = await reportModel.listReports();
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateReportInternal,
  generateScheduled,
  generateManual,
  listReports,
};
