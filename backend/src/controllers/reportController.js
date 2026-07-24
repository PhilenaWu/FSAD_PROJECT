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

module.exports = { generateReportInternal };
