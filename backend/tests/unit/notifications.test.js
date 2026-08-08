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
      const [manager_id, message, scope, urgency, status, send_time, sent_at, event_type, link] =
        params;
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
            event_type,
            link,
            created_at: '2026-07-15T00:00:00Z',
          },
        ],
      };
    }
    // resolveRecipients ({ type: 'users' }) — must precede the generic users
    // matcher below, which would otherwise swallow it.
    if (/SELECT id FROM users WHERE id = ANY/i.test(sql)) {
      return { rows: (params[0] ?? []).map((id) => ({ id })) };
    }
    // The persisted inbox (GET /api/notifications).
    if (/FROM notification_recipients r/i.test(sql)) {
      return {
        rows: [
          {
            id: 'notif-1',
            message: 'Water off 9–12',
            urgency: 'Warning',
            event_type: null,
            link: null,
            created_at: '2026-07-15T00:00:00Z',
            read: false,
            read_at: null,
          },
        ],
      };
    }
    if (/COUNT\(\*\)::int AS unread/i.test(sql)) {
      return { rows: [{ unread: 1 }] };
    }
    // The manager outbox (GET /api/notifications/sent).
    if (/LEFT JOIN notification_recipients r/i.test(sql)) {
      return {
        rows: [
          {
            id: 'notif-1',
            message: 'Water off 9–12',
            urgency: 'Warning',
            scope: { type: 'blocks', blocks: ['44A'] },
            status: 'Sent',
            send_time: null,
            sent_at: '2026-07-15T00:00:00Z',
            created_at: '2026-07-15T00:00:00Z',
            total_recipients: 2,
            read_count: 1,
          },
        ],
      };
    }
    // resolveRecipients (blocks / inspector_team / managers / admins).
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

// The persisted inbox. Before this endpoint the bell held items in React memory
// only, so anything sent while a recipient was offline was unreachable even
// though its notification_recipients row existed.
describe('GET /api/notifications', () => {
  test('200 with the caller own rows and an unread count', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body.unread_count).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: 'notif-1', read: false });
  });

  test('scopes the query to the caller, not a client-supplied id', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();
    await request(app).get('/api/notifications').set('Authorization', 'Bearer resident-token');

    const inbox = query.mock.calls.find(([sql]) => /FROM notification_recipients r/i.test(sql));
    expect(inbox[1][0]).toBe('res-1');
  });

  test('unread_only=true is passed through to the query', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();
    await request(app)
      .get('/api/notifications?unread_only=true')
      .set('Authorization', 'Bearer resident-token');

    const inbox = query.mock.calls.find(([sql]) => /FROM notification_recipients r/i.test(sql));
    expect(inbox[1][1]).toBe(true);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

// The manager's send history (D.6). Before this endpoint the only way to see a
// read receipt was the notification still held in page state after a send.
describe('GET /api/notifications/sent', () => {
  test('200 with the manager own sends and joined receipt counts', async () => {
    const res = await request(app)
      .get('/api/notifications/sent')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: 'notif-1',
      status: 'Sent',
      total_recipients: 2,
      read_count: 1,
    });
  });

  test('scopes the query to the calling manager', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();
    await request(app)
      .get('/api/notifications/sent')
      .set('Authorization', 'Bearer manager-token');

    const outbox = query.mock.calls.find(([sql]) =>
      /LEFT JOIN notification_recipients r/i.test(sql)
    );
    expect(outbox[1][0]).toBe('mgr-1');
  });

  test('403 for a non-manager role', async () => {
    const res = await request(app)
      .get('/api/notifications/sent')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
  });

  test('is not shadowed by the /:id/receipts route', async () => {
    const res = await request(app)
      .get('/api/notifications/sent')
      .set('Authorization', 'Bearer manager-token');

    // A receipts response would have notification_id/total_recipients at the
    // top level; the history returns a `data` array.
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// notifyEvent is the seam lifecycle transitions call. It must persist a row and
// emit exactly once, and it must never throw — the transition that triggered it
// has already committed, so a notification failure cannot be allowed to turn a
// successful state change into a 500 (G13).
describe('notificationService.notifyEvent', () => {
  const notificationService = require('../../src/services/notificationService');
  const socketService = require('../../src/services/socketService');

  beforeEach(() => {
    socketService.emitToRooms.mockClear();
  });

  test('persists the event and emits once, carrying event_type and link', async () => {
    const count = await notificationService.notifyEvent({
      event_type: 'rectified',
      scope: { type: 'managers' },
      message: 'Work submitted on Blk 44A',
      urgency: 'Warning',
      link: '/inspections/ins-1',
    });

    expect(count).toBe(2);
    expect(socketService.emitToRooms).toHaveBeenCalledTimes(1);
    const [rooms, event, payload] = socketService.emitToRooms.mock.calls[0];
    expect(rooms).toEqual(['manager-room']);
    expect(event).toBe('notification');
    expect(payload).toMatchObject({
      event_type: 'rectified',
      link: '/inspections/ins-1',
      urgency: 'Warning',
    });
  });

  test('resolves the admins scope to admin-room', async () => {
    await notificationService.notifyEvent({
      event_type: 'vendor_expired',
      scope: { type: 'admins' },
      message: 'Contract expired',
      urgency: 'Critical',
    });

    expect(socketService.emitToRooms.mock.calls[0][0]).toEqual(['admin-room']);
  });

  test('resolves the users scope to the ids and rooms the caller supplies', async () => {
    await notificationService.notifyEvent({
      event_type: 'defect_assigned',
      scope: {
        type: 'users',
        user_ids: ['ctr-user-1'],
        rooms: ['contractor-ctr-user-1'],
      },
      message: 'A defect was assigned to you',
      urgency: 'Warning',
    });

    expect(socketService.emitToRooms.mock.calls[0][0]).toEqual(['contractor-ctr-user-1']);
  });

  test('drops empty ids in the users scope rather than inserting null', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();

    const count = await notificationService.notifyEvent({
      event_type: 'defect_assigned',
      scope: { type: 'users', user_ids: [null, undefined], rooms: [] },
      message: 'Nobody to tell',
    });

    // No recipients, so no recipient insert and nothing to emit to. The real
    // emitToRooms early-returns on an empty room list, so the call is a no-op.
    expect(count).toBe(0);
    expect(query.mock.calls.some(([sql]) => /INSERT INTO notification_recipients/i.test(sql))).toBe(
      false
    );
    expect(socketService.emitToRooms.mock.calls[0][0]).toEqual([]);
  });

  // D.12: a contractor transition used to be two notifyEvent calls (managers,
  // then the originator), so it wrote two rows and anyone in both audiences saw
  // the same event twice. One scope, union-deduped, makes that impossible.
  test('managers_and_users unions managers with the named ids, deduped', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();

    // The generic `SELECT id FROM users` mock returns r1/r2 for the managers
    // leg; naming r2 as the inspector makes the two sets overlap.
    const count = await notificationService.notifyEvent({
      event_type: 'rectified',
      scope: {
        type: 'managers_and_users',
        user_ids: ['r2'],
        rooms: ['inspector-team'],
      },
      message: 'Work submitted on Blk 44A',
      urgency: 'Informational',
    });

    // r1 + r2, not r1 + r2 + r2.
    expect(count).toBe(2);
    const insert = query.mock.calls.find(([sql]) =>
      /INSERT INTO notification_recipients/i.test(sql)
    );
    expect(insert[1][1]).toEqual(['r1', 'r2']);
    expect(socketService.emitToRooms.mock.calls[0][0]).toEqual([
      'manager-room',
      'inspector-team',
    ]);
  });

  test('managers_and_users with no named ids still reaches the managers', async () => {
    const count = await notificationService.notifyEvent({
      event_type: 'acknowledged',
      scope: { type: 'managers_and_users', user_ids: [], rooms: [] },
      message: 'Acknowledged',
      urgency: 'Informational',
    });

    expect(count).toBe(2);
    expect(socketService.emitToRooms.mock.calls[0][0]).toEqual(['manager-room']);
  });

  test('swallows a delivery failure and does not throw (G13)', async () => {
    socketService.emitToRooms.mockImplementationOnce(() => {
      throw new Error('socket down');
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      notificationService.notifyEvent({
        event_type: 'rectified',
        scope: { type: 'managers' },
        message: 'Work submitted',
      })
    ).resolves.toBe(0);

    spy.mockRestore();
  });
});

// A scheduled send that can never succeed used to stay 'Scheduled', and
// findDueScheduled matches on exactly that — so the dispatcher retried it every
// 60 s for the life of the process.
describe('dispatchDueNotifications', () => {
  const notificationController = require('../../src/controllers/notificationController');
  const socketService = require('../../src/services/socketService');
  const { query } = require('../../src/config/db');

  test('marks a failed send Failed so it leaves the queue', async () => {
    query.mockClear();
    socketService.emitToRooms.mockImplementationOnce(() => {
      throw new Error('socket down');
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // One due notification, then the model's UPDATE.
    query.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'notif-due',
          message: 'scheduled',
          scope: { type: 'managers' },
          urgency: 'Warning',
          created_at: '2026-07-15T00:00:00Z',
        },
      ],
    }));

    const result = await notificationController.dispatchDueNotifications();

    expect(result).toMatchObject({ due: 1, sent: 0, failed: 1 });
    const marked = query.mock.calls.find(([sql]) => /SET status = 'Failed'/i.test(sql));
    expect(marked).toBeDefined();
    expect(marked[1]).toEqual(['notif-due']);

    spy.mockRestore();
  });

  test('marks a successful send Sent', async () => {
    query.mockClear();
    query.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'notif-due-2',
          message: 'scheduled',
          scope: { type: 'managers' },
          urgency: 'Informational',
          created_at: '2026-07-15T00:00:00Z',
        },
      ],
    }));

    const result = await notificationController.dispatchDueNotifications();

    expect(result).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(query.mock.calls.some(([sql]) => /SET status = 'Sent'/i.test(sql))).toBe(true);
  });
});
