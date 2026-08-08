// Mahdiya — individual contribution tests: PATCH /api/my-reports/:id.
//
// Lets a resident edit their own complaint (title/description/category/
// location) within 30 minutes of filing it. Covers the code in
// src/controllers/myReportsController.js (updateOwnReport) and
// src/models/myReportModel.js (updateOwnReport) — the app runs in-process
// (supertest); the Supabase auth and pg boundaries are mocked so the real
// route/controller/model flow is exercised without a network or database.
'use strict';

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      const subs = {
        'resident-token': 'res-1',
        'other-resident-token': 'res-2',
        'inspector-token': 'ins-1',
      };
      if (subs[token]) {
        return { data: { claims: { sub: subs[token], email: `${subs[token]}@example.com` } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// app.js requires these at load time regardless of which routes a test
// exercises — bodies only need to exist, this suite never calls them.
jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(async () => 'https://cloudinary.test/defects/mock.png'),
}));
jest.mock('../../src/controllers/cvController', () => ({
  detect: jest.fn(async () => ({ cvDetection: null, inspection: null })),
  batchScan: jest.fn(async () => ({ processed: 0, failed: 0, remaining: 0 })),
  listDetections: jest.fn((req, res) => res.json({ data: [], total: 0 })),
  createTicketFromDetection: jest.fn((req, res) => res.status(201).json({})),
  dismissDetection: jest.fn((req, res) => res.json({})),
}));
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

const profiles = {
  'res-1': { role: 'resident', status: 'active' },
  'res-2': { role: 'resident', status: 'active' },
  'ins-1': { role: 'inspector', status: 'active' },
};

let inspections;
function resetStore() {
  inspections = [
    {
      id: 'insp-fresh',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Fresh complaint',
      description: 'Original description',
      location_block: '44A',
      location_unit: '12-05',
      status: 'Open',
      category: 'Lift',
      created_at: new Date().toISOString(), // inside the 30-minute window
    },
    {
      id: 'insp-old',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Old complaint',
      description: 'Filed a while ago',
      location_block: '44A',
      status: 'Open',
      category: 'Lift',
      created_at: '2026-01-01T00:00:00Z', // long past the 30-minute window
    },
    {
      id: 'insp-inspector',
      resident_id: null,
      inspector_id: 'ins-1',
      title: "Inspector's own spot-check",
      description: null,
      location_block: '44A',
      status: 'Open',
      category: 'Lift',
      created_at: new Date().toISOString(),
    },
  ];
}

const mockQuery = jest.fn(async (sql, params = []) => {
  if (/FROM users WHERE id/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  if (/UPDATE inspections/i.test(sql) && /SET title/i.test(sql)) {
    const [id, residentId, title, description, category, location_block, location_unit] = params;
    const row = inspections.find((i) => i.id === id && i.resident_id === residentId);
    if (!row) return { rows: [] };
    Object.assign(row, { title, description, category, location_block, location_unit });
    return { rows: [{ ...row }] };
  }
  if (/FROM inspections/i.test(sql) && /resident_id = \$2 OR inspector_id = \$2/i.test(sql)) {
    const [id, userId] = params;
    const row = inspections.find(
      (i) => i.id === id && (i.resident_id === userId || i.inspector_id === userId)
    );
    return { rows: row ? [{ ...row }] : [] };
  }
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  query: (...args) => mockQuery(...args),
  pool: { connect: jest.fn() },
}));

const request = require('supertest');
const app = require('../../src/app');

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const validEdit = {
  title: 'Updated title',
  description: 'Updated description',
  category: 'Electrical',
  location_block: '44B',
  location_unit: '08-01',
};

beforeEach(() => {
  resetStore();
  mockQuery.mockClear();
});

describe('PATCH /api/my-reports/:id (Mahdiya — UC-003 report edit)', () => {
  it('lets a resident edit a report filed within the last 30 minutes', async () => {
    const res = await request(app)
      .patch('/api/my-reports/insp-fresh')
      .set(auth('resident-token'))
      .send(validEdit);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(validEdit);
  });

  it('rejects an edit once the 30-minute window has passed', async () => {
    const res = await request(app)
      .patch('/api/my-reports/insp-old')
      .set(auth('resident-token'))
      .send(validEdit);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EDIT_WINDOW_EXPIRED');
    // The original title is untouched.
    expect(inspections.find((i) => i.id === 'insp-old').title).toBe('Old complaint');
  });

  it('rejects a category outside the shared CATEGORIES whitelist', async () => {
    const res = await request(app)
      .patch('/api/my-reports/insp-fresh')
      .set(auth('resident-token'))
      .send({ ...validEdit, category: 'Not A Real Category' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it("404s rather than 403s on another resident's report — no existence leak", async () => {
    const res = await request(app)
      .patch('/api/my-reports/insp-fresh')
      .set(auth('other-resident-token'))
      .send(validEdit);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it("blocks an inspector from editing their own spot-check through this route", async () => {
    const res = await request(app)
      .patch('/api/my-reports/insp-inspector')
      .set(auth('inspector-token'))
      .send(validEdit);

    expect(res.status).toBe(403);
  });
});
