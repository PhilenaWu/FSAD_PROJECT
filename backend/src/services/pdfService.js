// UC-009 monthly report PDF generation. Renders aggregated ReportData plus an
// AI executive summary into a professional A4 PDF entirely in memory using
// pdfkit, and resolves to a Buffer (Phase 2 uploads/emails it). No filesystem.
'use strict';

const PDFDocument = require('pdfkit');

// Theme colours (estate brand). Kept as hex strings for pdfkit fill().
const BRAND = '#CF3225';
const INK = '#2E2E20';
const MUTED = '#888888';
const RULE = '#DDDDDD';

/**
 * Draw a section heading with an underline rule, returning nothing.
 * @param {PDFKit.PDFDocument} doc
 * @param {string} text
 */
function heading(doc, text) {
  doc.moveDown(0.8);
  doc.fillColor(BRAND).fontSize(13).font('Helvetica-Bold').text(text);
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(RULE)
    .stroke();
  doc.moveDown(0.5);
  doc.fillColor(INK).font('Helvetica').fontSize(10);
}

/**
 * Render a simple two-column (label, value) table. Rows with a zero-length list
 * render a muted "No data" line instead.
 * @param {PDFKit.PDFDocument} doc
 * @param {Array<[string, string]>} rows - [label, value] pairs.
 */
function twoColTable(doc, rows) {
  if (rows.length === 0) {
    doc.fillColor(MUTED).text('No data for this period.').fillColor(INK);
    return;
  }
  const left = doc.page.margins.left;
  const valueX = doc.page.width - doc.page.margins.right - 100;
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font('Helvetica').fillColor(INK).text(String(label), left, y, { width: 300 });
    doc.font('Helvetica-Bold').text(String(value), valueX, y, { width: 100, align: 'right' });
    doc.font('Helvetica');
  }
}

/**
 * Build the monthly estate maintenance report as a PDF.
 *
 * Layout (single flowing document, A4):
 *   1. Title + reporting period + generation date.
 *   2. Executive Summary (the AI/fallback paragraph).
 *   3. Key Metrics (total defects, avg rectification, SLA compliance).
 *   4. Defects by Status / by Category / by Block tables.
 *   5. Top Recurring Defects table.
 *   6. Cost Summary (actual, projected open, projected total).
 *
 * @param {import('../models/reportModel').ReportData} reportData - aggregated metrics.
 * @param {string} summary - executive summary paragraph.
 * @returns {Promise<Buffer>} resolves to the generated PDF as a Buffer.
 */
function generateMonthlyReportPDF(reportData, summary) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { period } = reportData;

    // 1. Title block
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22)
      .text('Monthly Estate Maintenance Report');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(`Reporting period: ${period.startDate} to ${period.endDate}`)
      .text(`Generated: ${new Date().toISOString().slice(0, 10)}`);

    // 2. Executive summary
    heading(doc, 'Executive Summary');
    doc.fontSize(10).fillColor(INK).text(summary, { align: 'left' });

    // 3. Key metrics
    heading(doc, 'Key Metrics');
    const avgDays = reportData.avgRectification.days;
    twoColTable(doc, [
      ['Total defects', String(reportData.totalDefects)],
      ['Average rectification time', avgDays == null ? '—' : `${avgDays} day(s)`],
      [
        'SLA compliance',
        `${reportData.sla.compliancePct}%  (${reportData.sla.compliant}/${reportData.sla.eligible})`,
      ],
    ]);

    // 4. Breakdowns
    heading(doc, 'Defects by Status');
    twoColTable(doc, reportData.byStatus.map((r) => [r.status, String(r.count)]));

    heading(doc, 'Defects by Category');
    twoColTable(doc, reportData.byCategory.map((r) => [r.category, String(r.count)]));

    heading(doc, 'Defects by Block');
    twoColTable(doc, reportData.byBlock.map((r) => [`Block ${r.block}`, String(r.count)]));

    // 5. Recurring defects
    heading(doc, 'Top Recurring Defects');
    twoColTable(
      doc,
      reportData.topRecurringDefects.map((r) => [`${r.category} — Block ${r.block}`, String(r.count)])
    );

    // 6. Costs
    heading(doc, 'Cost Summary');
    const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    twoColTable(doc, [
      ['Actual cost (closed defects)', money(reportData.costs.actual)],
      ['Projected cost (open predictions)', money(reportData.costs.estimated)],
      ['Total projected cost', money(reportData.costs.projected)],
    ]);

    doc.end();
  });
}

module.exports = { generateMonthlyReportPDF };
