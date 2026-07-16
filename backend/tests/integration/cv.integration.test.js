// Integration tests for CV — GET /api/cv/batch-scan (UC-007 retry_queue
// drain, CRON_SECRET-gated) and GET /api/cv/detections (manual review queue,
// manager-gated). The app runs in-process (supertest). Boundaries mocked so
// the test is deterministic and hits no network:
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:        in-memory retry_queue/cv_detections/users store
//   - roboflowService:  fake detectDefect (no Roboflow call)
'use strict';

process.env.CRON_SECRET = 'test-cron-secret';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
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

// --- Mock: Roboflow. Confidence is chosen per test via mockResolvedValueOnce. ---
jest.mock('../../src/services/roboflowService', () => ({
  detectDefect: jest.fn(),
  CONFIDENCE_THRESHOLD: 0.7,
}));

// --- Mock: the pg layer. A tiny in-memory retry_queue/cv_detections/users store. ---
const profiles = {
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
};
let retryQueue = [];
let cvDetections = [];

const mockQuery = jest.fn(async (sql, params = []) => {
  if (/SELECT role, status FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  if (/SELECT \* FROM retry_queue WHERE status = 'pending' AND retry_after/i.test(sql)) {
    return { rows: retryQueue.filter((r) => r.status === 'pending') };
  }
  if (/SELECT COUNT\(\*\)::int AS count FROM retry_queue/i.test(sql)) {
    return { rows: [{ count: retryQueue.filter((r) => r.status === 'pending').length }] };
  }
  if (/UPDATE retry_queue SET status = 'processed'/i.test(sql)) {
    const row = retryQueue.find((r) => r.id === params[0]);
    if (row) row.status = 'processed';
    return { rows: row ? [row] : [] };
  }
  if (/UPDATE retry_queue SET status = 'failed'/i.test(sql)) {
    const row = retryQueue.find((r) => r.id === params[0]);
    if (row) row.status = 'failed';
    return { rows: row ? [row] : [] };
  }
  if (/UPDATE retry_queue\s+SET attempts/i.test(sql)) {
    const row = retryQueue.find((r) => r.id === params[0]);
    if (row) row.attempts += 1;
    return { rows: row ? [row] : [] };
  }
  if (/SELECT \* FROM cv_detections WHERE status = \$1/i.test(sql)) {
    return { rows: cvDetections.filter((d) => d.status === params[0]) };
  }
  if (/INSERT INTO cv_detections/i.test(sql)) {
    return { rows: [{ id: 'cv-1', status: params[5] }] };
  }
  if (/INSERT INTO inspections/i.test(sql)) {
    return { rows: [{ id: 'insp-auto-1', source_type: 'cv_auto_detected' }] };
  }
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: (...args) => mockQuery(...args),
}));

const request = require('supertest');
const app = require('../../src/app');
const roboflowService = require('../../src/services/roboflowService');

beforeEach(() => {
  retryQueue = [];
  cvDetections = [];
  mockQuery.mockClear();
  roboflowService.detectDefect.mockReset();
});

describe('GET /api/cv/batch-scan', () => {
  test('401 without a valid CRON_SECRET', async () => {
    const res = await request(app).get('/api/cv/batch-scan');
    expect(res.status).toBe(401);
  });

  test('401 with the wrong secret', async () => {
    const res = await request(app)
      .get('/api/cv/batch-scan')
      .set('Authorization', 'Bearer wrong-secret');
    expect(res.status).toBe(401);
  });

  test('CV-T04: 200 with an empty queue — { processed: 0, failed: 0, remaining: 0 }', async () => {
    const res = await request(app)
      .get('/api/cv/batch-scan')
      .set('Authorization', 'Bearer test-cron-secret');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ processed: 0, failed: 0, remaining: 0 });
  });

  test('a pending row that clears the threshold is processed', async () => {
    retryQueue.push({
      id: 'rq-1',
      image_url: 'https://example.com/a.jpg',
      inspection_id: null,
      status: 'pending',
      attempts: 0,
    });
    roboflowService.detectDefect.mockResolvedValueOnce({
      defect_class: 'scratch',
      confidence: 0.8,
      bounding_box: { x: 1, y: 1, width: 1, height: 1 },
    });

    const res = await request(app)
      .get('/api/cv/batch-scan')
      .set('Authorization', 'Bearer test-cron-secret');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(retryQueue[0].status).toBe('processed');
  });
});

describe('GET /api/cv/detections', () => {
  test('401 without a token', async () => {
    const res = await request(app).get('/api/cv/detections');
    expect(res.status).toBe(401);
  });

  test('403 for a non-manager role', async () => {
    const res = await request(app)
      .get('/api/cv/detections')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('200 defaults to status=low_confidence for a manager', async () => {
    cvDetections.push(
      { id: 'cv-1', defect_class: 'spill', confidence: '0.445', status: 'low_confidence' },
      { id: 'cv-2', defect_class: 'scratch', confidence: '0.80', status: 'processed' }
    );

    const res = await request(app)
      .get('/api/cv/detections')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data).toEqual([
      { id: 'cv-1', defect_class: 'spill', confidence: '0.445', status: 'low_confidence' },
    ]);
  });

  test('200 respects an explicit ?status filter', async () => {
    cvDetections.push({ id: 'cv-2', defect_class: 'scratch', confidence: '0.80', status: 'processed' });

    const res = await request(app)
      .get('/api/cv/detections')
      .query({ status: 'processed' })
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe('cv-2');
  });
});
