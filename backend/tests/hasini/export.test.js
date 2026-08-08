// Unit tests for the PowerPoint export (UC-005 task 5.13b) — PPT-T01/T02 from
// the phase plan plus validation and role gating. Same mocked-supertest style
// as the analytics tests; pptx build + Cloudinary upload are mocked so no
// network or real deck generation happens.
'use strict';

jest.mock('../../../backend/src/config/supabase', () => ({
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

const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};

jest.mock('../../../backend/src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: jest.fn(async (sql, params = []) => {
    if (/SELECT role, status FROM users/i.test(sql)) {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    }
    if (/compliant_count/i.test(sql)) {
      return { rows: [{ compliant_count: 42, total_resolved: 55 }] };
    }
    return { rows: [] }; // heatmap/trends/scorecard shapes don't matter here
  }),
}));

// Deck build + upload mocked — controlled per test.
jest.mock('../../../backend/src/services/pptxService', () => ({
  buildDashboardDeck: jest.fn(async () => Buffer.from('fake-pptx')),
}));
jest.mock('../../../backend/src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(),
  uploadRaw: jest.fn(async () => 'https://res.cloudinary.com/demo/reports/dashboard-123.pptx'),
}));

const request = require('supertest');
const app = require('../../../backend/src/app');
const pptxService = require('../../../backend/src/services/pptxService');

const validBody = { views: ['heatmap', 'sla_gauge'], filters: { block: '44A' } };

describe('POST /api/export/pptx', () => {
  test('PPT-T01: 200 with a Cloudinary pptx_url for a manager', async () => {
    const res = await request(app)
      .post('/api/export/pptx')
      .set('Authorization', 'Bearer manager-token')
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.pptx_url).toMatch(/^https:\/\/res\.cloudinary\.com\/.+\.pptx$/);
  });

  test('PPT-T02: 500 EXPORT_FAILED when deck generation throws', async () => {
    pptxService.buildDashboardDeck.mockRejectedValueOnce(new Error('boom'));

    const res = await request(app)
      .post('/api/export/pptx')
      .set('Authorization', 'Bearer manager-token')
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('EXPORT_FAILED');
    expect(res.body.message).toMatch(/CSV/); // UI shows this as the fallback hint
  });

  test('400 VALIDATION_ERROR when views is missing or invalid', async () => {
    const res = await request(app)
      .post('/api/export/pptx')
      .set('Authorization', 'Bearer manager-token')
      .send({ views: ['not-a-view'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('403 for a non-manager role', async () => {
    const res = await request(app)
      .post('/api/export/pptx')
      .set('Authorization', 'Bearer resident-token')
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
