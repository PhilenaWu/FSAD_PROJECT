// Unit tests for UC-009 Phase 2 orchestration (reportController.generateReportInternal).
// Every dependency is mocked — the reportModel and all four services — so the
// test verifies orchestration only: call order, arguments, and error handling.
'use strict';

jest.mock('../../src/models/reportModel');
jest.mock('../../src/services/openaiService');
jest.mock('../../src/services/pdfService');
jest.mock('../../src/services/cloudinaryService');
jest.mock('../../src/services/emailService');

const reportModel = require('../../src/models/reportModel');
const openaiService = require('../../src/services/openaiService');
const pdfService = require('../../src/services/pdfService');
const cloudinaryService = require('../../src/services/cloudinaryService');
const emailService = require('../../src/services/emailService');
const { generateReportInternal } = require('../../src/controllers/reportController');

const START = '2026-06-24T00:00:00.000Z';
const END = '2026-07-24T00:00:00.000Z';
const LABEL = '2026-06-24 to 2026-07-24';

const REPORT_DATA = { totalDefects: 10, sla: { compliancePct: 70 } };
const SUMMARY = 'Executive summary text.';
const PDF_BUFFER = Buffer.from('%PDF-1.3 fake');
const REPORT_URL = 'https://res.cloudinary.com/demo/raw/upload/reports/monthly.pdf';
const SAVED_ROW = { id: 'rep-1', report_status: 'Ready', email_delivered: false };

// Happy-path mock wiring; individual tests override as needed.
function wireHappyPath() {
  reportModel.getReportData.mockResolvedValue(REPORT_DATA);
  openaiService.generateExecutiveSummary.mockResolvedValue(SUMMARY);
  pdfService.generateMonthlyReportPDF.mockResolvedValue(PDF_BUFFER);
  cloudinaryService.uploadReport.mockResolvedValue(REPORT_URL);
  reportModel.createReport.mockResolvedValue(SAVED_ROW);
  reportModel.getReportRecipients.mockResolvedValue(['mgr@example.com', 'admin@example.com']);
  emailService.sendReportEmail.mockResolvedValue(undefined);
  reportModel.updateEmailDelivered.mockResolvedValue({ ...SAVED_ROW, email_delivered: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  wireHappyPath();
});

describe('generateReportInternal — happy path', () => {
  test('calls each step in the correct order', async () => {
    const order = [];
    reportModel.getReportData.mockImplementation(async () => (order.push('getReportData'), REPORT_DATA));
    openaiService.generateExecutiveSummary.mockImplementation(async () => (order.push('summary'), SUMMARY));
    pdfService.generateMonthlyReportPDF.mockImplementation(async () => (order.push('pdf'), PDF_BUFFER));
    cloudinaryService.uploadReport.mockImplementation(async () => (order.push('upload'), REPORT_URL));
    reportModel.createReport.mockImplementation(async () => (order.push('createReport'), SAVED_ROW));
    reportModel.getReportRecipients.mockImplementation(async () => (order.push('recipients'), ['mgr@example.com']));
    emailService.sendReportEmail.mockImplementation(async () => (order.push('email'), undefined));
    reportModel.updateEmailDelivered.mockImplementation(async () => (order.push('updateEmailDelivered'), { ...SAVED_ROW, email_delivered: true }));

    await generateReportInternal(START, END, 'manual');

    expect(order).toEqual([
      'getReportData',
      'summary',
      'pdf',
      'upload',
      'createReport',
      'recipients',
      'email',
      'updateEmailDelivered',
    ]);
  });

  test('passes the expected arguments through the pipeline', async () => {
    await generateReportInternal(START, END, 'manual');

    expect(reportModel.getReportData).toHaveBeenCalledWith(START, END);
    expect(openaiService.generateExecutiveSummary).toHaveBeenCalledWith(REPORT_DATA);
    expect(pdfService.generateMonthlyReportPDF).toHaveBeenCalledWith(REPORT_DATA, SUMMARY);
    expect(cloudinaryService.uploadReport).toHaveBeenCalledWith(
      PDF_BUFFER,
      'monthly-report-2026-06-24-to-2026-07-24'
    );
    expect(reportModel.createReport).toHaveBeenCalledWith({
      report_url: REPORT_URL,
      period_start: START,
      period_end: END,
      triggered_by: 'manual',
      report_status: 'Ready',
      email_delivered: false,
    });
    expect(emailService.sendReportEmail).toHaveBeenCalledWith(
      REPORT_URL,
      LABEL,
      'mgr@example.com,admin@example.com'
    );
    expect(reportModel.updateEmailDelivered).toHaveBeenCalledWith('rep-1', true);
  });

  test('returns the row with email_delivered true after a successful send', async () => {
    const result = await generateReportInternal(START, END, 'github_actions');
    expect(result.email_delivered).toBe(true);
  });
});

describe('generateReportInternal — Cloudinary upload failure', () => {
  test("saves the row with report_status 'Upload failed' and sends no email", async () => {
    cloudinaryService.uploadReport.mockRejectedValue(new Error('cloudinary down'));
    reportModel.createReport.mockResolvedValue({
      id: 'rep-2',
      report_status: 'Upload failed',
      email_delivered: false,
    });

    const result = await generateReportInternal(START, END, 'manual');

    expect(reportModel.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ report_status: 'Upload failed', report_url: null })
    );
    expect(emailService.sendReportEmail).not.toHaveBeenCalled();
    expect(reportModel.updateEmailDelivered).not.toHaveBeenCalled();
    expect(result.report_status).toBe('Upload failed');
  });
});

describe('generateReportInternal — email failure is non-fatal', () => {
  test("report stays 'Ready' and email_delivered is not flagged when the email throws", async () => {
    emailService.sendReportEmail.mockRejectedValue(new Error('smtp timeout'));

    const result = await generateReportInternal(START, END, 'manual');

    // Row was still saved as Ready; the delivered flag was never set.
    expect(reportModel.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ report_status: 'Ready' })
    );
    expect(reportModel.updateEmailDelivered).not.toHaveBeenCalled();
    expect(result).toEqual(SAVED_ROW); // the persisted 'Ready' row, email_delivered false
  });

  test('skips email delivery when there are no manager/admin recipients', async () => {
    reportModel.getReportRecipients.mockResolvedValue([]);

    const result = await generateReportInternal(START, END, 'manual');

    expect(emailService.sendReportEmail).not.toHaveBeenCalled();
    expect(reportModel.updateEmailDelivered).not.toHaveBeenCalled();
    expect(result).toEqual(SAVED_ROW);
  });
});
