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
      if (token === 'contractor-token') {
        return { data: { claims: { sub: 'ctr-1', email: 'ctr@example.com' } }, error: null };
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
  'ctr-1': { role: 'contractor', status: 'active' },
};

// The two rows some tests below need to vary — receipt totals, and whether the
// caller has a recipient row at all. Reset before each test.
const state = {
  receipts: { total: 5, read_count: 2 },
  markReadRow: { id: 'nr-1', read: true, read_at: '2026-07-15T00:01:00Z' },
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
    // getReceiptCounts — must precede the recipients matchers below.
    if (/AS total,/i.test(sql) && /FROM notification_recipients/i.test(sql)) {
      return { rows: [{ ...state.receipts }] };
    }
    // findSender — the author looked up for the live payload.
    if (/SELECT full_name, role FROM users/i.test(sql)) {
      return params[0] === 'mgr-1'
        ? { rows: [{ full_name: 'Tan Wei Ming', role: 'manager' }] }
        : { rows: [] };
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
      return { rows: state.markReadRow ? [state.markReadRow] : [] };
    }
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');

const blocksScope = { type: 'blocks', blocks: ['44A'] };

beforeEach(() => {
  state.receipts = { total: 5, read_count: 2 };
  state.markReadRow = { id: 'nr-1', read: true, read_at: '2026-07-15T00:01:00Z' };
});

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

  test('403 for a role that may not send at all', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer resident-token')
      .send({ message: 'hi', scope: blocksScope, urgency: 'Warning' });

    expect(res.status).toBe(403);
  });

  // Item 16b — a contractor reports upwards and nowhere else.
  test('201 when a contractor sends to the managers and inspectors', async () => {
    const { emitToRooms } = require('../../src/services/socketService');
    emitToRooms.mockClear();

    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer contractor-token')
      .send({
        message: 'Lift 2 is unsafe — stopped work',
        scope: { type: 'managers_and_inspectors' },
        urgency: 'Critical',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'Sent', recipients_count: 2 });
    // Both staff rooms, and no block-{n} — a resident must never be reached.
    expect(emitToRooms).toHaveBeenCalledWith(
      ['manager-room', 'inspector-team'],
      'notification',
      expect.objectContaining({ message: 'Lift 2 is unsafe — stopped work' })
    );
  });

  // The contractor picks the audience, so the narrower staff scopes are open
  // to them too — still staff-only.
  test('201 when a contractor addresses the inspectors alone', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer contractor-token')
      .send({
        message: 'Access to the motor room refused',
        scope: { type: 'inspector_team' },
        urgency: 'Warning',
      });

    expect(res.status).toBe(201);
  });

  test('403 when a contractor tries to address residents', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', 'Bearer contractor-token')
      .send({ message: 'hi neighbours', scope: blocksScope, urgency: 'Warning' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('401 without a token', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .send({ message: 'hi', scope: blocksScope, urgency: 'Warning' });

    expect(res.status).toBe(401);
  });

  // The rest of the input guard. Each of these is also refused by the composer
  // in the UI, so a request that goes round the form meets the same rules.
  describe('validation', () => {
    const post = (body) =>
      request(app)
        .post('/api/notifications')
        .set('Authorization', 'Bearer manager-token')
        .send(body);

    test('400 on an empty message', async () => {
      const res = await post({ message: '', scope: blocksScope, urgency: 'Warning' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('400 on an urgency outside the three levels', async () => {
      const res = await post({ message: 'hi', scope: blocksScope, urgency: 'Urgent' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Informational, Warning or Critical/);
    });

    test('400 when no scope is given', async () => {
      const res = await post({ message: 'hi', urgency: 'Warning' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/scope is required/);
    });

    test('400 on an unknown scope type', async () => {
      const res = await post({ message: 'hi', scope: { type: 'everyone' }, urgency: 'Warning' });
      expect(res.status).toBe(400);
    });

    test('400 when the blocks scope names no block', async () => {
      const res = await post({
        message: 'hi',
        scope: { type: 'blocks', blocks: [] },
        urgency: 'Warning',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/non-empty array/);
    });

    test('400 when the contractor scope names no contractor', async () => {
      const res = await post({ message: 'hi', scope: { type: 'contractor' }, urgency: 'Warning' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/contractor_user_id is required/);
    });

    test('a rejected send writes no notification and emits nothing', async () => {
      const { query } = require('../../src/config/db');
      const { emitToRooms } = require('../../src/services/socketService');
      query.mockClear();
      emitToRooms.mockClear();

      await post({ message: 'hi', scope: { type: 'everyone' }, urgency: 'Warning' });

      expect(query.mock.calls.some(([sql]) => /INSERT INTO notifications/i.test(sql))).toBe(false);
      expect(emitToRooms).not.toHaveBeenCalled();
    });
  });

  // The live payload has to carry what the persisted inbox returns, or a
  // message shows its sender only after a refresh.
  describe('the live socket payload', () => {
    test('names the author of a human send', async () => {
      const { emitToRooms } = require('../../src/services/socketService');
      emitToRooms.mockClear();

      await request(app)
        .post('/api/notifications')
        .set('Authorization', 'Bearer manager-token')
        .send({ message: 'Water off 9–12', scope: blocksScope, urgency: 'Warning' });

      const [, , payload] = emitToRooms.mock.calls[0];
      expect(payload).toMatchObject({
        message: 'Water off 9–12',
        sender_name: 'Tan Wei Ming',
        sender_role: 'manager',
      });
    });
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

  // Reading someone else's notification has to fail: the model returns no row
  // when the caller has no recipient row for it, and that is a 404 rather than
  // a silent success.
  test('404 when the caller is not a recipient', async () => {
    state.markReadRow = null;

    const res = await request(app)
      .patch('/api/notifications/notif-1/read')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('updates the caller own row — the user id comes from the token', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();

    await request(app)
      .patch('/api/notifications/notif-1/read')
      .set('Authorization', 'Bearer resident-token')
      // A client-supplied id must not be honoured.
      .send({ resident_id: 'mgr-1' });

    const update = query.mock.calls.find(([sql]) =>
      /UPDATE notification_recipients SET read/i.test(sql)
    );
    expect(update[1]).toEqual(['notif-1', 'res-1']);
  });

  test('401 without a token', async () => {
    const res = await request(app).patch('/api/notifications/notif-1/read');
    expect(res.status).toBe(401);
  });
});

// The endpoint ReadReceiptBadge polls every 30 s. It is the only per-notification
// count in the API — the history endpoint joins its counts for many rows at once.
describe('GET /api/notifications/:id/receipts', () => {
  test('200 with the totals for the manager who sent it', async () => {
    const res = await request(app)
      .get('/api/notifications/notif-1/receipts')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      notification_id: 'notif-1',
      total_recipients: 5,
      read_count: 2,
      unread_count: 3,
    });
  });

  // unread is derived rather than stored, so it has to stay consistent at both
  // ends of the range instead of going negative or double-counting.
  test('everyone has read it — unread_count is 0, not a leftover', async () => {
    state.receipts = { total: 5, read_count: 5 };

    const res = await request(app)
      .get('/api/notifications/notif-1/receipts')
      .set('Authorization', 'Bearer manager-token');

    expect(res.body).toMatchObject({ total_recipients: 5, read_count: 5, unread_count: 0 });
  });

  test('a notification with no recipients answers zeros rather than failing', async () => {
    state.receipts = { total: 0, read_count: 0 };

    const res = await request(app)
      .get('/api/notifications/notif-1/receipts')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total_recipients: 0, read_count: 0, unread_count: 0 });
  });

  test('counts the notification named in the path', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();

    await request(app)
      .get('/api/notifications/notif-42/receipts')
      .set('Authorization', 'Bearer manager-token');

    const counts = query.mock.calls.find(
      ([sql]) => /AS total,/i.test(sql) && /FROM notification_recipients/i.test(sql)
    );
    expect(counts[1]).toEqual(['notif-42']);
  });

  // Who read a broadcast is the sender's business, not a recipient's.
  test('403 for a non-manager role', async () => {
    const res = await request(app)
      .get('/api/notifications/notif-1/receipts')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
  });

  test('403 for a contractor, who may send but not audit', async () => {
    const res = await request(app)
      .get('/api/notifications/notif-1/receipts')
      .set('Authorization', 'Bearer contractor-token');

    expect(res.status).toBe(403);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/notifications/notif-1/receipts');
    expect(res.status).toBe(401);
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

  // A recipient has to be able to tell who wrote a message — a contractor's
  // report and an automatic lifecycle event read identically without it.
  test('the inbox query joins the author so the recipient sees a sender', async () => {
    const { query } = require('../../src/config/db');
    query.mockClear();
    await request(app).get('/api/notifications').set('Authorization', 'Bearer resident-token');

    const [inboxSql] = query.mock.calls.find(([sql]) =>
      /FROM notification_recipients r/i.test(sql)
    );
    expect(inboxSql).toMatch(/LEFT JOIN users u ON u\.id = n\.manager_id/i);
    expect(inboxSql).toMatch(/u\.full_name AS sender_name/i);
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

  // ?limit reaches SQL, so it is bounded in the controller rather than trusted.
  describe('paging', () => {
    const limitOf = () => {
      const { query } = require('../../src/config/db');
      return query.mock.calls.find(([sql]) => /FROM notification_recipients r/i.test(sql))[1][2];
    };
    const get = async (qs = '') => {
      const { query } = require('../../src/config/db');
      query.mockClear();
      await request(app)
        .get(`/api/notifications${qs}`)
        .set('Authorization', 'Bearer resident-token');
    };

    test('defaults to 50', async () => {
      await get();
      expect(limitOf()).toBe(50);
    });

    test('honours a sensible limit', async () => {
      await get('?limit=10');
      expect(limitOf()).toBe(10);
    });

    test('caps an oversized limit at 100', async () => {
      await get('?limit=5000');
      expect(limitOf()).toBe(100);
    });

    test('falls back to the default on a non-numeric limit', async () => {
      await get('?limit=all');
      expect(limitOf()).toBe(50);
    });

    test('falls back to the default on a zero or negative limit', async () => {
      await get('?limit=-1');
      expect(limitOf()).toBe(50);
    });
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

  describe('paging', () => {
    const limitOf = () => {
      const { query } = require('../../src/config/db');
      return query.mock.calls.find(([sql]) =>
        /LEFT JOIN notification_recipients r/i.test(sql)
      )[1][1];
    };
    const get = async (qs = '') => {
      const { query } = require('../../src/config/db');
      query.mockClear();
      await request(app)
        .get(`/api/notifications/sent${qs}`)
        .set('Authorization', 'Bearer manager-token');
    };

    test('defaults to 50', async () => {
      await get();
      expect(limitOf()).toBe(50);
    });

    test('caps an oversized limit at 100', async () => {
      await get('?limit=5000');
      expect(limitOf()).toBe(100);
    });
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

  // A lifecycle event has no human author (manager_id is NULL), which is what
  // lets the bell render it as "System" rather than attributing it to someone.
  test('a lifecycle event has no sender rather than a stale one', async () => {
    await notificationService.notifyEvent({
      event_type: 'rectified',
      scope: { type: 'managers' },
      message: 'Work submitted on Blk 44A',
    });

    const [, , payload] = socketService.emitToRooms.mock.calls[0];
    expect(payload.sender_name).toBeNull();
    expect(payload.sender_role).toBeNull();
  });

  // The server half of the contractor deep link: the bell row carries a link
  // with ?defect=<id>, and ContractorInboxPage opens that job on arrival. If the
  // link is not persisted and emitted, tapping the notification can only drop
  // the contractor on an inbox with nothing selected.
  describe('the contractor deep link', () => {
    const assignEvent = () =>
      notificationService.notifyEvent({
        event_type: 'defect_assigned',
        scope: { type: 'users', user_ids: ['ctr-1'], rooms: ['contractor-ctr-1'] },
        message: 'Blk 44B — Scratches on lift door has been assigned to you.',
        urgency: 'Warning',
        link: '/contractor-inbox?defect=insp-1',
      });

    test('persists the ?defect= link on the notification row', async () => {
      const { query } = require('../../src/config/db');
      query.mockClear();

      await assignEvent();

      const insert = query.mock.calls.find(([sql]) => /INSERT INTO notifications/i.test(sql));
      // (manager_id, message, scope, urgency, status, send_time, sent_at, event_type, link)
      expect(insert[1][0]).toBeNull(); // no human author
      expect(insert[1][7]).toBe('defect_assigned');
      expect(insert[1][8]).toBe('/contractor-inbox?defect=insp-1');
    });

    test('emits the same link live, to that contractor room only', async () => {
      await assignEvent();

      const [rooms, event, payload] = socketService.emitToRooms.mock.calls[0];
      expect(rooms).toEqual(['contractor-ctr-1']);
      expect(event).toBe('notification');
      expect(payload).toMatchObject({
        event_type: 'defect_assigned',
        link: '/contractor-inbox?defect=insp-1',
      });
      // Never a block room — a neighbour must not be told about this job.
      expect(rooms.some((r) => r.startsWith('block-'))).toBe(false);
    });
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

  test('an empty queue is a no-op, not an error', async () => {
    query.mockClear();
    socketService.emitToRooms.mockClear();

    const result = await notificationController.dispatchDueNotifications();

    expect(result).toEqual({ due: 0, sent: 0, failed: 0 });
    expect(socketService.emitToRooms).not.toHaveBeenCalled();
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
