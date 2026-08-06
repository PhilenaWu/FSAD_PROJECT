// Unit tests for general app feedback (sidebar "Feedback" form). Same
// mocked-supertest style as the notifications tests.
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
    if (/INSERT INTO feedback/i.test(sql)) {
      const [, message, rating] = params;
      return { rows: [{ id: 'fb-1', message, rating, created_at: '2026-07-15T00:00:00Z' }] };
    }
    return { rows: [] };
  }),
}));

const request = require('supertest');
const app = require('../../src/app');

describe('POST /api/feedback', () => {
  test('201 with the created row for a signed-in user', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', 'Bearer resident-token')
      .send({ message: 'Love the new status board!', rating: 5 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 'fb-1',
      message: 'Love the new status board!',
      rating: 5,
    });
  });

  test('201 with no rating (optional)', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', 'Bearer resident-token')
      .send({ message: 'Just a comment, no rating.' });

    expect(res.status).toBe(201);
    expect(res.body.rating).toBeNull();
  });

  test('400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', 'Bearer resident-token')
      .send({ rating: 4 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('400 when rating is out of range', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', 'Bearer resident-token')
      .send({ message: 'hi', rating: 9 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('401 without a token', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });
});
