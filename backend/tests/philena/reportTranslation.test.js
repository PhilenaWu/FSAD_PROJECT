// Integration tests for GET /api/my-reports/:id/translation (048) — the
// resident-facing half of translation: the manager's closing remark, checklist
// remarks and audit-history notes on a resident's OWN report, translated into
// their preferred_language. Deliberately separate from the manager-side
// GET /api/inspections/:id/translation (philena/inspections.integration.test.js)
// — it translates different text (not the resident's own title/description)
// and is scoped by ownership like the rest of UC-003, not by role alone.
//
// The app runs in-process (supertest); Supabase auth, pg, and openaiService
// are mocked so the real route/controller/model flow is exercised without a
// network, database, or a real OpenAI call.
'use strict';

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      const subs = {
        'resident-token': 'res-1',
        'other-resident-token': 'res-2',
        'manager-token': 'mgr-1',
      };
      if (subs[token]) {
        return { data: { claims: { sub: subs[token], email: `${subs[token]}@example.com` } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// Modules app.js loads at require time that this suite never exercises.
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

const mockTranslateReportExtras = jest.fn();
jest.mock('../../src/services/openaiService', () => ({
  translateReportExtras: (...args) => mockTranslateReportExtras(...args),
}));

const profiles = {
  'res-1': { role: 'resident', status: 'active' },
  'res-2': { role: 'resident', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
};

let inspections;
let history;
let checklistResults;
let translations;

function resetStore() {
  inspections = [
    {
      id: 'insp-1',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Lift button broken',
      description: 'Button 3 unresponsive',
      status: 'Resolved',
      closing_remark: 'Replaced the button module.',
      is_deleted: false,
    },
    // Nothing to translate: no closing remark, and (below) no remarked
    // checklist items or noted history entries either.
    {
      id: 'insp-2',
      resident_id: 'res-1',
      inspector_id: null,
      title: 'Corridor light flickering',
      status: 'Assigned',
      closing_remark: null,
      is_deleted: false,
    },
  ];
  history = [
    {
      id: 'hist-1',
      inspection_id: 'insp-1',
      action: 'Reviewed by Inspector',
      note: 'Checked, all good',
      actor_id: 'ins-1',
      created_at: '2026-08-01T00:00:00Z',
    },
    // insp-2 has a history row, but with no note — must not reach the prompt.
    {
      id: 'hist-2',
      inspection_id: 'insp-2',
      action: 'Assigned',
      note: null,
      actor_id: 'mgr-1',
      created_at: '2026-08-02T00:00:00Z',
    },
  ];
  checklistResults = [
    {
      id: 'chk-1',
      inspection_id: 'insp-1',
      remark: 'Door catches on the sill',
      section: 'B — Lift Car',
      item_text: 'Door side gaps',
    },
  ];
  translations = [];
}

const mockQuery = jest.fn(async (sql, params = []) => {
  if (/FROM users WHERE id/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // findOwnRecord (via findOwnDetail): WHERE id = $1 AND (resident_id = $2 OR inspector_id = $2)
  if (/FROM inspections/i.test(sql) && /resident_id = \$2 OR inspector_id = \$2/i.test(sql)) {
    const [id, userId] = params;
    const row = inspections.find((i) => i.id === id && i.resident_id === userId);
    return { rows: row ? [{ ...row }] : [] };
  }
  if (/FROM inspection_history/i.test(sql)) {
    const rows = history.filter((h) => h.inspection_id === params[0]);
    return { rows };
  }
  if (/FROM checklist_results/i.test(sql)) {
    return { rows: checklistResults.filter((c) => c.inspection_id === params[0]) };
  }
  // saveExtrasTranslation upsert
  if (/INSERT INTO inspection_translations/i.test(sql) && /closing_remark/i.test(sql)) {
    const [inspection_id, target_language, closing_remark, checklist_remarks, history_notes, extras_was_translated] = params;
    const existing = translations.find(
      (t) => t.inspection_id === inspection_id && t.target_language === target_language
    );
    const row = { inspection_id, target_language, closing_remark, checklist_remarks, history_notes, extras_was_translated };
    if (existing) Object.assign(existing, row);
    else translations.push(row);
    return { rows: [] };
  }
  // findExtrasTranslation
  if (/FROM inspection_translations/i.test(sql)) {
    const [inspectionId, targetLanguage] = params;
    const row = translations.find(
      (t) => t.inspection_id === inspectionId && t.target_language === targetLanguage && t.extras_was_translated !== null
    );
    if (!row) return { rows: [] };
    // Real pg auto-parses JSONB columns; mirror that here.
    return {
      rows: [{
        closing_remark: row.closing_remark,
        checklist_remarks: JSON.parse(row.checklist_remarks),
        history_notes: JSON.parse(row.history_notes),
        extras_was_translated: row.extras_was_translated,
      }],
    };
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

beforeEach(() => {
  resetStore();
  mockQuery.mockClear();
  mockTranslateReportExtras.mockReset();
});

describe('GET /api/my-reports/:id/translation', () => {
  test('400 for a lang outside en/zh/ms/ta', async () => {
    const res = await request(app)
      .get('/api/my-reports/insp-1/translation')
      .query({ lang: 'fr' })
      .set(auth('resident-token'));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockTranslateReportExtras).not.toHaveBeenCalled();
  });

  test("404s on another resident's report — no existence leak", async () => {
    const res = await request(app)
      .get('/api/my-reports/insp-1/translation')
      .query({ lang: 'zh' })
      .set(auth('other-resident-token'));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('403s for a manager — this route is the originator view', async () => {
    const res = await request(app)
      .get('/api/my-reports/insp-1/translation')
      .query({ lang: 'zh' })
      .set(auth('manager-token'));

    expect(res.status).toBe(403);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/my-reports/insp-1/translation').query({ lang: 'zh' });
    expect(res.status).toBe(401);
  });

  // The "nothing to translate" short-circuit itself lives inside
  // openaiService.translateReportExtras (unit-tested in translation.test.js,
  // which mocks the OpenAI SDK rather than the whole service) — this only
  // pins that the controller passes insp-2's empty fields through faithfully
  // and returns whatever the service decides.
  test('a report with nothing to translate still round-trips cleanly', async () => {
    mockTranslateReportExtras.mockResolvedValue({
      closing_remark: null,
      checklist_remarks: [],
      history_notes: [],
      was_translated: false,
    });

    const res = await request(app)
      .get('/api/my-reports/insp-2/translation')
      .query({ lang: 'zh' })
      .set(auth('resident-token'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      closing_remark: null,
      checklist_remarks: [],
      history_notes: [],
      was_translated: false,
    });
    const [extras] = mockTranslateReportExtras.mock.calls[0];
    expect(extras.closing_remark).toBeNull();
  });

  test('calls the translator with the closing remark, checklist remarks and history notes', async () => {
    mockTranslateReportExtras.mockResolvedValue({
      closing_remark: '已更换按钮模块。',
      checklist_remarks: [{ id: 'chk-1', remark: '门卡在门槛上' }],
      history_notes: [{ id: 'hist-1', note: '已检查，一切正常' }],
      was_translated: true,
    });

    const res = await request(app)
      .get('/api/my-reports/insp-1/translation')
      .query({ lang: 'zh' })
      .set(auth('resident-token'));

    expect(res.status).toBe(200);
    expect(res.body.closing_remark).toBe('已更换按钮模块。');
    expect(mockTranslateReportExtras).toHaveBeenCalledTimes(1);
    const [extras, lang] = mockTranslateReportExtras.mock.calls[0];
    expect(extras.closing_remark).toBe('Replaced the button module.');
    expect(extras.checklist_results).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'chk-1', remark: 'Door catches on the sill' })])
    );
    expect(extras.history).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'hist-1', note: 'Checked, all good' })])
    );
    expect(lang).toBe('zh');
  });

  test('a second request for the same report/language is served from cache', async () => {
    mockTranslateReportExtras.mockResolvedValue({
      closing_remark: '已更换按钮模块。',
      checklist_remarks: [],
      history_notes: [],
      was_translated: true,
    });

    await request(app)
      .get('/api/my-reports/insp-1/translation')
      .query({ lang: 'zh' })
      .set(auth('resident-token'));
    const res = await request(app)
      .get('/api/my-reports/insp-1/translation')
      .query({ lang: 'zh' })
      .set(auth('resident-token'));

    expect(res.status).toBe(200);
    expect(res.body.closing_remark).toBe('已更换按钮模块。');
    expect(mockTranslateReportExtras).toHaveBeenCalledTimes(1);
  });

  test('503 TRANSLATION_UNAVAILABLE when the service fails, and nothing is cached', async () => {
    const err = new Error('no key');
    err.serviceUnavailable = true;
    mockTranslateReportExtras.mockRejectedValue(err);

    const res = await request(app)
      .get('/api/my-reports/insp-1/translation')
      .query({ lang: 'zh' })
      .set(auth('resident-token'));

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('TRANSLATION_UNAVAILABLE');
    expect(translations).toEqual([]);
  });
});
