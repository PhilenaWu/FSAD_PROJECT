// Integration tests for the UC-014 demo alert trigger:
//   GET /api/inspections/defect-alert-demo  (cronGuard -> defectAlertDemo)
//
// This is the endpoint the GitHub Actions demo workflow calls during the
// presentation. It is deliberately not tied to a database record — it posts a
// fixed sample defect to everyone on DEFECT_ALERT_RECIPIENTS — so the only
// boundaries worth mocking are env, the mail service, and the two clients the
// app touches at boot.
//
// The app runs in-process (supertest). Mocked boundaries:
//   - config/env:      dummy boot vars + a known CRON_SECRET / recipients list
//   - config/supabase: present only so app boot succeeds; the cron path must
//                      never reach it, which is itself asserted below
//   - config/db:       likewise — this route does no DB work at all
//   - services/emailService: the send seam, so no SMTP connection is opened
'use strict';

// cronGuard reads the secret through config/env, so the mock below is the only
// place the value is set — no process.env fiddling needed.
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
  DEFECT_ALERT_RECIPIENTS: 'a@example.com,b@example.com',
}));

jest.mock('../../src/config/supabase', () => ({
  auth: { getClaims: jest.fn(async () => ({ data: null, error: { message: 'invalid token' } })) },
}));

const mockQuery = jest.fn(async () => ({ rows: [] }));
jest.mock('../../src/config/db', () => ({
  pool: { connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })) },
  testConnection: jest.fn(),
  query: mockQuery,
}));

jest.mock('../../src/services/emailService');

const request = require('supertest');
const config = require('../../src/config/env');
const supabase = require('../../src/config/supabase');
const emailService = require('../../src/services/emailService');
const app = require('../../src/app');

const ROUTE = '/api/inspections/defect-alert-demo';
const RECIPIENTS = 'a@example.com,b@example.com';
const AUTH = 'Bearer test-cron-secret';

beforeEach(() => {
  jest.clearAllMocks();
  // The controller reads these off the module object at request time, so
  // restore them here — individual tests reassign to cover the other branches.
  config.CRON_SECRET = 'test-cron-secret';
  config.DEFECT_ALERT_RECIPIENTS = RECIPIENTS;
  emailService.sendDefectAlert.mockResolvedValue(undefined);
});

describe(`GET ${ROUTE} — cron secret gating`, () => {
  test('401 without an Authorization header', async () => {
    const res = await request(app).get(ROUTE);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });

  test('401 with an incorrect secret', async () => {
    const res = await request(app).get(ROUTE).set('Authorization', 'Bearer wrong-secret');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });

  test('401 when the right secret is sent without the Bearer scheme', async () => {
    // cronGuard only reads the token after a literal 'Bearer ' prefix; a bare
    // secret must not slip through.
    const res = await request(app).get(ROUTE).set('Authorization', 'test-cron-secret');

    expect(res.status).toBe(401);
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });

  test('401 with no secret configured, even when the caller also sends nothing', async () => {
    // Closed by default: an unconfigured CRON_SECRET makes the route
    // unreachable rather than open to an empty-handed caller.
    config.CRON_SECRET = undefined;

    const res = await request(app).get(ROUTE).set('Authorization', 'Bearer undefined');

    expect(res.status).toBe(401);
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });
});

describe(`GET ${ROUTE} — success`, () => {
  test('200 and reports the recipients it sent to', async () => {
    const res = await request(app).get(ROUTE).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true, recipients: RECIPIENTS });
  });

  test('sends one alert, handing the whole recipient list to the mail service', async () => {
    await request(app).get(ROUTE).set('Authorization', AUTH);

    // One call, not one per address — sendDefectAlert takes the comma-separated
    // list straight through as the `to` header.
    expect(emailService.sendDefectAlert).toHaveBeenCalledTimes(1);
    expect(emailService.sendDefectAlert.mock.calls[0][1]).toBe(RECIPIENTS);
  });

  test('the sample defect carries the fixed demo content', async () => {
    await request(app).get(ROUTE).set('Authorization', AUTH);

    const [defect] = emailService.sendDefectAlert.mock.calls[0];
    expect(defect).toMatchObject({
      title: 'Lift cabin door fault',
      category: 'Lift',
      priority: 'High',
      location_block: '44A',
      location_unit: null,
    });
    expect(defect.description).toMatch(/demo alert/i);
  });

  test('the sample deadline is two weeks out, so the mail reads as live', async () => {
    const before = Date.now();
    await request(app).get(ROUTE).set('Authorization', AUTH);

    const [defect] = emailService.sendDefectAlert.mock.calls[0];
    const deadline = new Date(defect.target_deadline).getTime();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;

    expect(defect.target_deadline).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deadline).toBeGreaterThanOrEqual(before + fourteenDays);
    // Generous upper bound: this only has to prove it is 14 days and not 13/15.
    expect(deadline).toBeLessThan(before + fourteenDays + 60_000);
  });

  test('touches neither the database nor Supabase auth', async () => {
    // The demo alert is deliberately record-free, and the cron path has no
    // logged-in user to verify.
    await request(app).get(ROUTE).set('Authorization', AUTH);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(supabase.auth.getClaims).not.toHaveBeenCalled();
  });
});

describe(`GET ${ROUTE} — failure modes`, () => {
  test('400 NO_RECIPIENTS when DEFECT_ALERT_RECIPIENTS is unset', async () => {
    config.DEFECT_ALERT_RECIPIENTS = undefined;

    const res = await request(app).get(ROUTE).set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_RECIPIENTS');
    expect(res.body.message).toMatch(/DEFECT_ALERT_RECIPIENTS/);
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });

  test('400 NO_RECIPIENTS for an empty recipients string', async () => {
    config.DEFECT_ALERT_RECIPIENTS = '';

    const res = await request(app).get(ROUTE).set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_RECIPIENTS');
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });

  test('a rejected SMTP send surfaces as a 500 rather than a false success', async () => {
    // sendDefectAlert's only failure mode is the transport rejecting
    // (bad credentials, SMTP unreachable). The controller forwards it to the
    // error handler, so the workflow sees a red run instead of "sent: true".
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    emailService.sendDefectAlert.mockRejectedValue(new Error('Invalid login: 535 auth failed'));

    const res = await request(app).get(ROUTE).set('Authorization', AUTH);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SERVER_ERROR');
    expect(res.body.sent).toBeUndefined();
    // NODE_ENV is 'test', so the handler passes the real message through.
    expect(res.body.message).toMatch(/535 auth failed/);

    logged.mockRestore();
  });
});
