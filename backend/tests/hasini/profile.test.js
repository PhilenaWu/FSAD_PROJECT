// Unit tests for PATCH /api/users/me — the resident profile page's self-service
// edit (full_name + phone). Same approach as the analytics tests: the app runs
// in-process via supertest with config/supabase and config/db mocked, so the
// real route → middleware → controller → model chain runs with no network.
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
jest.mock('../../../backend/src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      if (token === 'ghost-token') {
        return { data: { claims: { sub: 'ghost-1', email: 'ghost@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: the pg layer. Dispatch on SQL shape. ---
const residentRow = {
  id: 'res-1',
  email: 'res@example.com',
  full_name: 'Res Ident',
  role: 'resident',
  status: 'active',
  block_number: '44A',
  unit_number: '05-123',
  phone: null,
};

const mockQuery = jest.fn(async (sql, params = []) => {
  // requireAuth profile lookup
  if (/SELECT role, status FROM users/i.test(sql)) {
    if (params[0] === 'res-1') return { rows: [{ role: 'resident', status: 'active' }] };
    return { rows: [] };
  }
  // updateOwnProfile — echo the row back with the supplied changes applied,
  // mirroring COALESCE (null keeps the old value) and NULLIF('') for phone.
  if (/UPDATE users/i.test(sql) && /full_name = COALESCE/i.test(sql)) {
    const [id, fullName, phone] = params;
    if (id !== 'res-1') return { rows: [] };
    return {
      rows: [{
        ...residentRow,
        full_name: fullName ?? residentRow.full_name,
        phone: phone == null ? residentRow.phone : (phone === '' ? null : phone),
      }],
    };
  }
  return { rows: [] };
});

jest.mock('../../../backend/src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: (...args) => mockQuery(...args),
}));

const request = require('supertest');
const app = require('../../../backend/src/app');

const asResident = (req) => req.set('Authorization', 'Bearer resident-token');

describe('PATCH /api/users/me', () => {
  test('200: updates full_name and phone and returns the updated row', async () => {
    const res = await asResident(
      request(app).patch('/api/users/me').send({ full_name: 'New Name', phone: '9123 4567' })
    );
    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe('New Name');
    expect(res.body.phone).toBe('9123 4567');
    // Never trusts the body for identity — the id param is the token's sub.
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE users/i.test(sql));
    expect(updateCall[1][0]).toBe('res-1');
  });

  test('200: omitted fields are left unchanged (COALESCE path)', async () => {
    const res = await asResident(
      request(app).patch('/api/users/me').send({ phone: '8000 0000' })
    );
    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe('Res Ident'); // untouched
    expect(res.body.phone).toBe('8000 0000');
  });

  test('200: empty-string phone clears the stored number', async () => {
    const res = await asResident(
      request(app).patch('/api/users/me').send({ phone: '' })
    );
    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
  });

  test('400 VALIDATION_ERROR: blank full_name', async () => {
    const res = await asResident(
      request(app).patch('/api/users/me').send({ full_name: '   ' })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('400 VALIDATION_ERROR: phone over 30 characters', async () => {
    const res = await asResident(
      request(app).patch('/api/users/me').send({ phone: '9'.repeat(31) })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('401 without a token', async () => {
    const res = await request(app).patch('/api/users/me').send({ full_name: 'X' });
    expect(res.status).toBe(401);
  });

  test('404 NOT_FOUND when the caller has no profile row', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', 'Bearer ghost-token')
      .send({ full_name: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
