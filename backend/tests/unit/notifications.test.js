// Unit tests for UC-008 notifications (send / schedule / role gating / mark
// read). Same mocked-supertest style as the analytics/recommendations tests:
// config/supabase and config/db are mocked, and socketService is stubbed so the
// controller doesn't reach the (un-initialised) Socket.IO server.
'use strict';

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

// Stub the real-time seam — no Socket.IO server runs under test.
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    if (/SELECT role, status FROM users/i.test(sql)) {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    }
    if (/INSERT INTO notifications/i.test(sql)) {
      const [manager_id, message, scope, urgency, status, send_time, sent_at] = params;
      return {
        rows: [
          {
            id: 'notif-1',
            manager_id,
            message,
            scope,
            urgency,
            status,
            send_time,
            sent_at,
            created_at: '2026-07-15T00:00:00Z',
          },
        ],
      };
    }
    // resolveRecipients (blocks): two residents match.
    if (/SELECT id FROM users/i.test(sql)) {
      return { rows: [{ id: 'r1' }, { id: 'r2' }] };
    }
    if (/INSERT INTO notification_recipients/i.test(sql)) {
      return { rows: [] };
    }
    if (/UPDATE notification_recipients SET read/i.test(sql)) {
      return { rows: [{ id: 'nr-1', read: true, read_at: '2026-07-15T00:01:00Z' }] };
    }
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');

const blocksScope = { type: 'blocks', blocks: ['44A'] };

describe('POST /api/notifications', () => {
  test('201 + recipients_count for an immediate manager send', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer manager-token')
      .send({ message: 'Water off 9–12', scope: blocksScope, urgency: 'Warning' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'Sent', recipients_count: 2 });
  });

  test('201 + Scheduled when send_time is in the future', async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer manager-token')
      .send({ message: 'Lift service tomorrow', scope: blocksScope, urgency: 'Informational', send_time: future });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Scheduled');
  });

  test('400 when the message exceeds 500 characters', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer manager-token')
      .send({ message: 'x'.repeat(501), scope: blocksScope, urgency: 'Warning' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('403 for a non-manager role', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer resident-token')
      .send({ message: 'hi', scope: blocksScope, urgency: 'Warning' });

    expect(res.status).toBe(403);
  });

  test('401 without a token', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .send({ message: 'hi', scope: blocksScope, urgency: 'Warning' });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  test('200 when a recipient marks it read', async () => {
    const res = await request(app)
      .patch('/api/notifications/notif-1/read')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notification_id: 'notif-1', read: true });
  });
});
