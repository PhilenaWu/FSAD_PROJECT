// Integration tests for the UC-009 report routes (Phase 3). The app runs
// in-process (supertest). Boundaries mocked for determinism / no network:
//   - process.env.CRON_SECRET: known value (cronGuard reads it directly)
//   - config/env:      dummy boot vars + known CRON_SECRET
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:       SQL-routed mock (only the requireRole profile lookup)
//   - reportModel + the four services: mocked, so the real route -> middleware ->
//     controller -> generateReportInternal chain runs with stubbed I/O.
// Verifies cron-secret gating, manager/resident role access, and that the routes
// trigger the controller with the right trigger source and date range.
'use strict';

// cronGuard validates against process.env.CRON_SECRET — set it before app load.
process.env.CRON_SECRET = 'test-cron-secret';

jest.mock('../../src/config/env', () => ({
  PORT: 5000,
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgres://test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  CLOUDINARY_CLOUD_NAME: 'test',
  CLOUDINARY_API_KEY: 'test',
  CLOUDINARY_API_SECRET: 'test',
  CRON_SECRET: 'test-cron-secret',
  OPENAI_API_KEY: undefined,
}));

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'manager-token') {
        return { data: { claims: { sub: 'mgr-1', email: 'mgr@example.com' } }, error: null };
      }
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// Only the requireRole profile lookup hits the db here (reportModel is mocked).
const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};
const mockQuery = jest.fn(async (sql, params = []) => {
  if (/SELECT role, status FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  return { rows: [] };
});
jest.mock('../../src/config/db', () => ({
  pool: { connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })) },
  testConnection: jest.fn(),
  query: mockQuery,
}));

// Mock reportModel + services so generateReportInternal runs without I/O.
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

const request = require('supertest');
const app = require('../../src/app');

const SAVED_ROW = { id: 'rep-1', report_status: 'Ready', email_delivered: true };

beforeEach(() => {
  jest.clearAllMocks();
  reportModel.getReportData.mockResolvedValue({ totalDefects: 3 });
  openaiService.generateExecutiveSummary.mockResolvedValue('summary');
  pdfService.generateMonthlyReportPDF.mockResolvedValue(Buffer.from('%PDF-'));
  cloudinaryService.uploadReport.mockResolvedValue('https://cdn/reports/r.pdf');
  reportModel.createReport.mockResolvedValue({ id: 'rep-1', report_status: 'Ready' });
  reportModel.getReportRecipients.mockResolvedValue(['mgr@example.com']);
  emailService.sendReportEmail.mockResolvedValue(undefined);
  reportModel.updateEmailDelivered.mockResolvedValue(SAVED_ROW);
  reportModel.listReports.mockResolvedValue([SAVED_ROW]);
});

describe('GET /api/reports/generate — cron secret gating', () => {
  test('401 without an Authorization header', async () => {
    const res = await request(app).get('/api/reports/generate');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(reportModel.getReportData).not.toHaveBeenCalled();
  });

  test('401 with an incorrect secret', async () => {
    const res = await request(app)
      .get('/api/reports/generate')
      .set('Authorization', 'Bearer wrong-secret');
    expect(res.status).toBe(401);
    expect(reportModel.getReportData).not.toHaveBeenCalled();
  });

  test('200 with the correct secret; generates for the previous calendar month', async () => {
    const res = await request(app)
      .get('/api/reports/generate')
      .set('Authorization', 'Bearer test-cron-secret');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(SAVED_ROW); // row after a successful email send

    // triggered_by is 'github_actions' for the scheduled path
    expect(reportModel.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ triggered_by: 'github_actions' })
    );
    // previous full calendar month: start/end are the 1st of consecutive months
    const [start, end] = reportModel.getReportData.mock.calls[0];
    expect(start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(end).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(new Date(start) < new Date(end)).toBe(true);

    // cron path must not touch Supabase auth
    const supabase = require('../../src/config/supabase');
    expect(supabase.auth.getClaims).not.toHaveBeenCalled();
  });
});

describe('POST /api/reports/generate-manual — role access', () => {
  test('401 without a token', async () => {
    const res = await request(app).post('/api/reports/generate-manual');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('403 for a resident', async () => {
    const res = await request(app)
      .post('/api/reports/generate-manual')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(reportModel.getReportData).not.toHaveBeenCalled();
  });

  test('201 for a manager with no body: current month to date, triggered_by manual', async () => {
    const res = await request(app)
      .post('/api/reports/generate-manual')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(SAVED_ROW);
    expect(reportModel.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ triggered_by: 'manual' })
    );
    const [start, end] = reportModel.getReportData.mock.calls[0];
    expect(start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/); // 1st of this month
    expect(new Date(start) < new Date(end)).toBe(true);
  });

  test('201 for a manager with an explicit date range uses that range', async () => {
    const startDate = '2026-01-01T00:00:00.000Z';
    const endDate = '2026-02-01T00:00:00.000Z';
    const res = await request(app)
      .post('/api/reports/generate-manual')
      .set('Authorization', 'Bearer manager-token')
      .send({ startDate, endDate });

    expect(res.status).toBe(201);
    expect(reportModel.getReportData).toHaveBeenCalledWith(startDate, endDate);
  });
});

describe('GET /api/reports — archive list', () => {
  test('401 without a token', async () => {
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(401);
  });

  test('403 for a resident', async () => {
    const res = await request(app)
      .get('/api/reports')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });

  test('200 for a manager returns the report list', async () => {
    const res = await request(app)
      .get('/api/reports')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [SAVED_ROW], total: 1 });
    expect(reportModel.listReports).toHaveBeenCalledTimes(1);
  });
});
