// Unit tests for GET /api/users/contacts — the role help/contacts block
// (defect list items 4, 27, 28). Same mocked-supertest style as the feedback
// and notifications tests.
'use strict';

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      const ids = {
        'manager-token': 'mgr-1',
        'admin-token': 'adm-1',
        'resident-token': 'res-1',
      };
      if (ids[token]) {
        return { data: { claims: { sub: ids[token], email: `${ids[token]}@example.com` } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

jest.mock('../../src/config/db', () => {
  const ROLES = { 'mgr-1': 'manager', 'adm-1': 'admin', 'res-1': 'resident' };
  const BY_ROLE = {
    admin: [
      { id: 'adm-1', full_name: 'Steven Tan', email: 'steven.tan.admin@emservices.sg', phone: '6500 0311' },
    ],
    manager: [
      { id: 'mgr-1', full_name: 'Rachel Lim', email: 'rachel.lim.manager@emservices.sg', phone: '6500 0321' },
      // No number published — the endpoint still returns the row.
      { id: 'mgr-2', full_name: 'Zoe Ng', email: 'zoe.ng.manager@emservices.sg', phone: null },
    ],
  };
  return {
    pool: {},
    testConnection: jest.fn(),
    query: jest.fn(async (sql, params = []) => {
      if (/SELECT role, status FROM users/i.test(sql)) {
        return { rows: [{ role: ROLES[params[0]], status: 'active' }] };
      }
      if (/FROM users\s+WHERE role = \$1 AND status = 'active'/i.test(sql)) {
        return { rows: BY_ROLE[params[0]] ?? [] };
      }
      if (/SELECT \* FROM users WHERE id = \$1/i.test(sql)) {
        return { rows: [{ id: params[0], role: ROLES[params[0]], status: 'active' }] };
      }
      return { rows: [] };
    }),
  };
});

const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/users/contacts', () => {
  test('a manager gets the admins — the number behind their "Need help?" card', async () => {
    const res = await request(app)
      .get('/api/users/contacts')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ full_name: 'Steven Tan', phone: '6500 0311' });
  });

  test('an admin gets the managers, including one with no phone', async () => {
    const res = await request(app)
      .get('/api/users/contacts')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.full_name)).toEqual(['Rachel Lim', 'Zoe Ng']);
    expect(res.body[1].phone).toBeNull();
  });

  test('a resident is refused — staff numbers are not readable by other roles', async () => {
    const res = await request(app)
      .get('/api/users/contacts')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
  });

  test('no token is refused', async () => {
    const res = await request(app).get('/api/users/contacts');
    expect(res.status).toBe(401);
  });
});
