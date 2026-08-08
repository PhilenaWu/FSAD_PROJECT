// Unit tests for the D.7 overdue chase (CHASE-T01 – CHASE-T05).
// Same mocked-supertest style as vendors.test.js: supabase, db, cloudinary, mail,
// socket and notification seams are mocked; no real network or DB.
'use strict';

process.env.CRON_SECRET = 'test-cron-secret';
// Set deliberately: the demo CC list must never mask an unreachable contractor
// (A4), so these tests assert the behaviour with it configured.
process.env.DEFECT_ALERT_RECIPIENTS = 'team@example.com';

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async () => ({
      data: null,
      error: { message: 'invalid token' },
    })),
  },
}));

jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(),
  uploadRaw: jest.fn(),
}));

jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

jest.mock('../../src/services/emailService', () => ({
  sendDefectAlert: jest.fn(),
  sendReportEmail: jest.fn(),
}));

jest.mock('../../src/services/notificationService', () => ({
  notifyEvent: jest.fn(async () => 1),
  deliver: jest.fn(),
}));

const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })) },
  testConnection: jest.fn(),
  query: (...args) => mockQuery(...args),
}));

const request = require('supertest');
const app = require('../../src/app');
const emailService = require('../../src/services/emailService');
const notificationService = require('../../src/services/notificationService');

// A record 3 days from its deadline, with a reachable contractor.
function dueRecord(overrides = {}) {
  return {
    id: 'insp-1',
    title: 'Lift inspection — 44A-L1',
    category: 'Miscellaneous',
    priority: 'Medium',
    status: 'Assigned',
    location_block: '44A',
    location_unit: null,
    description: null,
    target_deadline: '2026-08-19T00:00:00.000Z',
    contractor_id: 'ctr-1',
    contact_email: 'service@konemaint.com.sg',
    contractor_user_id: 'usr-1',
    contractor_name: 'KONE Maintenance',
    lift_code: '44A-L1',
    days_remaining: 3,
    ...overrides,
  };
}

const state = {
  dueRows: [],        // findDueForChase result
  chasedToday: [],    // inspection ids already chased today
  logRows: [],        // defect_email_log inserts
  history: [],        // inspection_history inserts
};

beforeEach(() => {
  jest.clearAllMocks();
  state.dueRows = [];
  state.chasedToday = [];
  state.logRows = [];
  state.history = [];

  mockQuery.mockImplementation(async (sql, params = []) => {
    // findDueForChase
    if (/FROM inspections i\s+JOIN contractors c/i.test(sql)) {
      return { rows: state.dueRows };
    }
    // sentToday — the once-per-record-per-day guard
    if (/FROM defect_email_log/i.test(sql)) {
      return { rows: state.chasedToday.includes(params[0]) ? [{ '?column?': 1 }] : [] };
    }
    if (/INSERT INTO defect_email_log/i.test(sql)) {
      const [inspection_id, contractor_id, recipient, email_type, status, error_message] = params;
      const row = { id: `log-${state.logRows.length + 1}`, inspection_id, contractor_id, recipient, email_type, status, error_message };
      state.logRows.push(row);
      return { rows: [row] };
    }
    if (/INSERT INTO inspection_history/i.test(sql)) {
      const [inspection_id, actor_id, action, previous_status, new_status, note] = params;
      state.history.push({ inspection_id, actor_id, action, previous_status, new_status, note });
      return { rows: [] };
    }
    return { rows: [] };
  });
});

const runChase = () =>
  request(app)
    .get('/api/inspections/overdue-chase')
    .set('Authorization', 'Bearer test-cron-secret');

describe('GET /api/inspections/overdue-chase', () => {
  // CHASE-T01
  test('a record due in 3 days gets one chase email and an audit row', async () => {
    state.dueRows = [dueRecord()];

    const res = await runChase();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ due: 1, chased: 1, skipped: 0 });

    expect(emailService.sendDefectAlert).toHaveBeenCalledTimes(1);
    const [record, to, options] = emailService.sendDefectAlert.mock.calls[0];
    expect(record.id).toBe('insp-1');
    expect(to).toContain('service@konemaint.com.sg');
    expect(options).toMatchObject({ email_type: 'overdue_chase', days_remaining: 3 });

    // The audit action that UC-015's completeness check is missing.
    expect(state.history).toEqual([
      expect.objectContaining({
        inspection_id: 'insp-1',
        action: 'Overdue Reminder Sent',
        previous_status: 'Assigned',
        new_status: 'Assigned',
        actor_id: null, // cron run — no human author
      }),
    ]);
    expect(state.logRows).toEqual([
      expect.objectContaining({ email_type: 'overdue_chase', status: 'sent' }),
    ]);
  });

  // CHASE-T02 — idempotency: a re-run the same day sends nothing.
  test('a record already chased today is skipped', async () => {
    state.dueRows = [dueRecord()];
    state.chasedToday = ['insp-1'];

    const res = await runChase();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ due: 1, chased: 0, skipped: 1 });
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
    expect(state.history).toHaveLength(0);
  });

  test('an overdue record is chased with a negative day count', async () => {
    state.dueRows = [dueRecord({ days_remaining: -4, status: 'Acknowledged' })];

    const res = await runChase();

    expect(res.status).toBe(200);
    expect(res.body.chased).toBe(1);
    const [, , options] = emailService.sendDefectAlert.mock.calls[0];
    expect(options.days_remaining).toBe(-4);
    // Managers escalate, so an overdue record reaches them as Critical.
    expect(notificationService.notifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'overdue_chase',
        scope: { type: 'managers' },
        urgency: 'Critical',
      })
    );
  });

  // A4 — the contractor is unreachable. Logged as failed so the manager's chip
  // can show it, and NOT sent to the demo CC list alone: a copy reaching the team
  // is not the contractor being notified.
  test('a contractor with no contact email is logged as failed, not emailed', async () => {
    state.dueRows = [dueRecord({ contact_email: null })];

    const res = await runChase();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ chased: 0, skipped: 1 });
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
    expect(state.logRows).toEqual([
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('No contractor contact email'),
      }),
    ]);
    // No audit row: nothing was actually sent.
    expect(state.history).toHaveLength(0);
  });

  // G13 — one bad record must not abort the daily run.
  test('an SMTP failure is logged and the remaining records still go out', async () => {
    state.dueRows = [
      dueRecord({ id: 'insp-1' }),
      dueRecord({ id: 'insp-2', title: 'Lift inspection — 44B-L2' }),
    ];
    emailService.sendDefectAlert.mockRejectedValueOnce(new Error('smtp down'));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await runChase();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ due: 2, chased: 1, skipped: 1 });
    expect(state.logRows).toEqual([
      expect.objectContaining({ inspection_id: 'insp-1', status: 'failed', error_message: 'smtp down' }),
      expect.objectContaining({ inspection_id: 'insp-2', status: 'sent' }),
    ]);
    // Only the successful one is claimed in the audit trail.
    expect(state.history).toEqual([
      expect.objectContaining({ inspection_id: 'insp-2', action: 'Overdue Reminder Sent' }),
    ]);
    logged.mockRestore();
  });

  test('nothing due is a clean no-op', async () => {
    const res = await runChase();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ due: 0, chased: 0, skipped: 0 });
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });

  test('401 without the cron secret', async () => {
    const res = await request(app).get('/api/inspections/overdue-chase');
    expect(res.status).toBe(401);
  });

  // The scope rules live in SQL, so assert the query rather than the behaviour:
  // On Hold pauses the clock (G11) and must never be chased.
  test('only Assigned/Acknowledged records are selected, never a held one', async () => {
    await runChase();

    const [sql] = mockQuery.mock.calls.find(([s]) =>
      /FROM inspections i\s+JOIN contractors c/i.test(s)
    );
    expect(sql).toMatch(/status IN \('Assigned', 'Acknowledged'\)/);
    // A hold is an audit-trail fact rather than a status now, so "not held" is
    // a NOT over the latest 'On Hold'/'Resumed' row. COALESCE keeps a
    // never-held record (no such row, so NULL) from being dropped by the NOT.
    expect(sql).toMatch(/NOT \(COALESCE\(\(SELECT h\.action/);
    expect(sql).toMatch(/action IN \('On Hold', 'Resumed'\)/);
    // D−3 and from D+0 onward, not a four-day countdown.
    expect(sql).toMatch(/= 3/);
    expect(sql).toMatch(/<= 0/);
  });
});
