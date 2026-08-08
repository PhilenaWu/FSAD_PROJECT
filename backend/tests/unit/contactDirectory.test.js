// Unit tests for GET /api/contacts — the estate/emergency directory behind the
// sidebar "Need help?" card and the emergency contacts page (migration 039).
// Same mocked-supertest style as the feedback tests.
'use strict';

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    if (/FROM contact_directory/i.test(sql)) {
      return {
        rows: [
          {
            id: 'cd-1',
            label: 'Managing office',
            description: 'Estate maintenance, lift faults, general enquiries',
            phone: '6500 0300',
            category: 'estate',
            icon_key: 'apartment',
            is_help_line: true,
          },
          {
            id: 'cd-2',
            label: 'Police',
            description: 'National emergency line',
            phone: '999',
            category: 'emergency',
            icon_key: 'police',
            is_help_line: false,
          },
        ],
      };
    }
    if (/SELECT \* FROM users WHERE id = \$1/i.test(sql)) {
      return { rows: [{ id: params[0], role: 'resident', status: 'active' }] };
    }
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/contacts', () => {
  test('a resident gets the directory in display order', async () => {
    const res = await request(app)
      .get('/api/contacts')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.label)).toEqual(['Managing office', 'Police']);
  });

  test('exactly one row is flagged as the sidebar help line', async () => {
    const res = await request(app)
      .get('/api/contacts')
      .set('Authorization', 'Bearer resident-token');

    const helpLines = res.body.filter((c) => c.is_help_line);
    expect(helpLines).toHaveLength(1);
    expect(helpLines[0].phone).toBe('6500 0300');
  });

  test('no token is refused', async () => {
    const res = await request(app).get('/api/contacts');
    expect(res.status).toBe(401);
  });
});
