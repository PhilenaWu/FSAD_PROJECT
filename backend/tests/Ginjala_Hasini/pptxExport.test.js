// Tests for the UC-011 admin cost PPTX export (task 5.19c). Two halves:
//
//   1. The service, against the REAL PptxGenJS library (reached via
//      jest.requireActual so the endpoint mocks below don't apply). Assertions
//      read the deck the library actually built — pptx.slides, each slide's
//      _slideObjects, and _relsChart[n].data for native chart series — so a
//      shape the library would reject cannot pass.
//   2. The endpoint, via supertest with the deck build and Cloudinary upload
//      mocked, so no file is written and no network is touched.
'use strict';

jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      const subs = {
        'admin-token': 'admin-1',
        'manager-token': 'mgr-1',
        'resident-token': 'res-1',
        'suspended-admin-token': 'admin-2',
      };
      if (subs[token]) {
        return { data: { claims: { sub: subs[token], email: `${subs[token]}@x.com` } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

const profiles = {
  'admin-1': { role: 'admin', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
  'res-1': { role: 'resident', status: 'active' },
  'admin-2': { role: 'admin', status: 'suspended' },
};

// Stands in for the cost queries the controller runs before building the deck.
const mockQuery = jest.fn(async (sql, params = []) => {
  if (/SELECT role, status FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  if (/AS total_actual/i.test(sql)) return { rows: [{ total_actual: 3000, jobs: 4 }] };
  if (/AS total_projected/i.test(sql)) return { rows: [{ total_projected: 3600 }] };
  if (/JOIN contractors c/i.test(sql)) {
    return { rows: [{ name: 'Otis Service SG', total: 2000, count: 3 }] };
  }
  if (/GROUP BY category/i.test(sql)) {
    return { rows: [{ category: 'Doors', actual: 2000, projected: 2400 }] };
  }
  if (/GROUP BY block/i.test(sql)) {
    return { rows: [{ block: '44A', actual: 2000, projected: 2400 }] };
  }
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  pool: {},
  testConnection: jest.fn(),
  query: mockQuery,
}));

jest.mock('../../src/services/pptxService', () => ({
  buildDashboardDeck: jest.fn(async () => Buffer.from('fake-pptx')),
  buildAdminCostDeck: jest.fn(),
  generateAdminCostPptx: jest.fn(async () => Buffer.from('fake-admin-pptx')),
}));
jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(),
  uploadRaw: jest.fn(async () => 'https://res.cloudinary.com/demo/reports/admin-costs-1.pptx'),
}));

const request = require('supertest');
const app = require('../../src/app');
const pptxService = require('../../src/services/pptxService');
const cloudinaryService = require('../../src/services/cloudinaryService');

// The genuine service + genuine PptxGenJS, bypassing the mock above.
const realPptxService = jest.requireActual('../../src/services/pptxService');

const PATH = '/api/export/admin-costs-pptx';

const COST_DATA = {
  filters: { startDate: '2026-01-01', endDate: '2026-03-31', block: '44A' },
  summary: { total_actual: 3000, total_projected: 3600, variance_pct: 20 },
  byCategory: [
    { category: 'Doors', actual: 2000, projected: 2400 },
    { category: 'Lift', actual: 1000, projected: 0 },
  ],
  byBlock: [
    { block: '44A', actual: 2000, projected: 2400 },
    { block: '44B', actual: 1000, projected: 1200 },
  ],
  byContractor: [
    { name: 'Otis Service SG', total: 2000, count: 4 },
    { name: 'Schindler', total: 1000, count: 2 },
  ],
};

// --- helpers that read the real deck ---------------------------------------
const objectsOf = (slide) => slide._slideObjects || [];
const textsOf = (slide) =>
  objectsOf(slide)
    .filter((o) => o._type === 'text')
    .map((o) => (o.text || []).map((t) => t.text).join(''));
const allText = (slide) => textsOf(slide).join(' | ');
const chartsOf = (slide) => slide._relsChart || [];
const tablesOf = (slide) => objectsOf(slide).filter((o) => o._type === 'table');
// arrTabRows -> plain string matrix
const tableRows = (table) => table.arrTabRows.map((row) => row.map((cell) => cell.text));

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// 1. Service — structure of the deck the real library builds
// ---------------------------------------------------------------------------

describe('pptxService.buildAdminCostDeck — deck structure', () => {
  let deck;
  beforeAll(() => {
    deck = realPptxService.buildAdminCostDeck(COST_DATA);
  });

  test('builds exactly five slides', () => {
    expect(deck.slides).toHaveLength(5);
  });

  test('slide 1: the required title and the date range', () => {
    const text = allText(deck.slides[0]);

    expect(text).toContain('Estate Operational Cost Summary');
    expect(text).toContain('2026-01-01 to 2026-03-31');
    expect(text).toContain('Block 44A');
  });

  test('slide 2: KPI labels and money-formatted values', () => {
    const text = allText(deck.slides[1]);

    expect(text).toContain('Cost summary');
    expect(text).toContain('Actual spend');
    expect(text).toContain('Projected exposure');
    expect(text).toContain('Variance');
    expect(text).toContain('$3,000.00');
    expect(text).toContain('$3,600.00');
    expect(text).toContain('+20%');
  });

  test('slide 3: a native bar chart with Actual and Projected series by category', () => {
    const slide = deck.slides[2];
    expect(allText(slide)).toContain('Cost by category');

    const charts = chartsOf(slide);
    expect(charts).toHaveLength(1);

    const series = charts[0].data;
    expect(series.map((s) => s.name)).toEqual(['Actual', 'Projected']);
    // labels are nested one level by the library
    expect(series[0].labels.flat()).toEqual(['Doors', 'Lift']);
    expect(series[0].values).toEqual([2000, 1000]);
    expect(series[1].values).toEqual([2400, 0]);
  });

  test('slide 4: the same chart shape keyed by block', () => {
    const slide = deck.slides[3];
    expect(allText(slide)).toContain('Cost by block');

    const series = chartsOf(slide)[0].data;
    expect(series[0].labels.flat()).toEqual(['44A', '44B']);
    expect(series[0].values).toEqual([2000, 1000]);
    expect(series[1].values).toEqual([2400, 1200]);
  });

  test('slide 5: a contractor table with a header row and derived columns', () => {
    const slide = deck.slides[4];
    expect(allText(slide)).toContain('Top 5 contractors by cost');

    const rows = tableRows(tablesOf(slide)[0]);
    expect(rows[0]).toEqual(['Contractor', 'Total cost', 'Jobs', 'Avg per job', 'Share']);
    // 2000 over 4 jobs = 500/job; 2000 of 3000 total = 67%
    expect(rows[1]).toEqual(['Otis Service SG', '$2,000.00', '4', '$500.00', '67%']);
    expect(rows[2]).toEqual(['Schindler', '$1,000.00', '2', '$500.00', '33%']);
  });

  test('the deck carries no chart on the KPI slide and no table on the chart slides', () => {
    expect(chartsOf(deck.slides[1])).toHaveLength(0);
    expect(tablesOf(deck.slides[2])).toHaveLength(0);
    expect(tablesOf(deck.slides[3])).toHaveLength(0);
  });
});

describe('pptxService.buildAdminCostDeck — data edge cases', () => {
  test('an unfiltered deck says so instead of leaving the range blank', () => {
    const deck = realPptxService.buildAdminCostDeck({ ...COST_DATA, filters: {} });
    const text = allText(deck.slides[0]);

    expect(text).toContain('All dates');
    expect(text).toContain('All blocks, lifts and contractors');
  });

  test.each([
    [{ startDate: '2026-01-01' }, '2026-01-01 onwards'],
    [{ endDate: '2026-03-31' }, 'Up to 2026-03-31'],
  ])('a one-sided date range reads as %o', (filters, expected) => {
    const deck = realPptxService.buildAdminCostDeck({ ...COST_DATA, filters });
    expect(allText(deck.slides[0])).toContain(expected);
  });

  test('a null variance renders as a dash, not 0%', () => {
    const deck = realPptxService.buildAdminCostDeck({
      ...COST_DATA,
      summary: { total_actual: 0, total_projected: 0, variance_pct: null },
    });
    const text = allText(deck.slides[1]);

    expect(text).toContain('—');
    expect(text).not.toContain('0%');
  });

  test('a negative variance keeps its sign and drops the plus', () => {
    const deck = realPptxService.buildAdminCostDeck({
      ...COST_DATA,
      summary: { total_actual: 3000, total_projected: 2400, variance_pct: -20 },
    });
    expect(allText(deck.slides[1])).toContain('-20%');
  });

  test('empty data still produces five slides, each with an explicit empty state', () => {
    const deck = realPptxService.buildAdminCostDeck({
      filters: {},
      summary: { total_actual: 0, total_projected: 0, variance_pct: null },
      byCategory: [],
      byBlock: [],
      byContractor: [],
    });

    expect(deck.slides).toHaveLength(5);
    expect(allText(deck.slides[2])).toContain('No cost data');
    expect(allText(deck.slides[3])).toContain('No cost data');
    expect(allText(deck.slides[4])).toContain('No contractor spend');
    // no chart is emitted when there is nothing to plot
    expect(chartsOf(deck.slides[2])).toHaveLength(0);
    expect(tablesOf(deck.slides[4])).toHaveLength(0);
    // the KPI slide still renders zeroes rather than blanks
    expect(allText(deck.slides[1])).toContain('$0.00');
  });

  test('called with no argument at all it still builds a deck', () => {
    const deck = realPptxService.buildAdminCostDeck();

    expect(deck.slides).toHaveLength(5);
    expect(allText(deck.slides[0])).toContain('Estate Operational Cost Summary');
  });

  test('the contractor table is capped at five rows and reports the remainder', () => {
    const byContractor = Array.from({ length: 8 }, (_, i) => ({
      name: `Vendor ${i + 1}`,
      total: (8 - i) * 100,
      count: 1,
    }));
    const deck = realPptxService.buildAdminCostDeck({ ...COST_DATA, byContractor });
    const slide = deck.slides[4];

    // header + 5 data rows
    expect(tableRows(tablesOf(slide)[0])).toHaveLength(6);
    expect(allText(slide)).toContain('3 further contractor(s) not shown');
    // the note states the full total, not just the shown subset (3600)
    expect(allText(slide)).toContain('$3,600.00');
  });

  test('a zero-job contractor shows a dash rather than dividing by zero', () => {
    const deck = realPptxService.buildAdminCostDeck({
      ...COST_DATA,
      byContractor: [{ name: 'Ghost Vendor', total: 0, count: 0 }],
    });
    const rows = tableRows(tablesOf(deck.slides[4])[0]);

    expect(rows[1]).toEqual(['Ghost Vendor', '$0.00', '0', '—', '—']);
  });

  test('charts are capped at ten bars and the caption reports the truncation', () => {
    const byBlock = Array.from({ length: 14 }, (_, i) => ({
      block: `B${i + 1}`,
      actual: (14 - i) * 100,
      projected: 0,
    }));
    const deck = realPptxService.buildAdminCostDeck({ ...COST_DATA, byBlock });
    const slide = deck.slides[3];

    expect(chartsOf(slide)[0].data[0].values).toHaveLength(10);
    expect(allText(slide)).toContain('Showing the top 10 of 14');
  });

  test('a suppressed projected series is captioned so zero is not read as no risk', () => {
    const deck = realPptxService.buildAdminCostDeck({
      ...COST_DATA,
      projections_suppressed: true,
    });

    expect(allText(deck.slides[2])).toContain('not tracked per lift or contractor');
    expect(allText(deck.slides[3])).toContain('not tracked per lift or contractor');
  });

  test('no truncation caption appears when nothing was truncated', () => {
    const deck = realPptxService.buildAdminCostDeck(COST_DATA);

    expect(allText(deck.slides[2])).not.toContain('Showing the top');
    expect(allText(deck.slides[4])).not.toContain('further contractor');
  });
});

describe('pptxService.generateAdminCostPptx — file output', () => {
  // Byte-level output is deliberately NOT asserted in Jest: PptxGenJS's
  // write() path uses a dynamic import() that Jest's CJS VM cannot service
  // without --experimental-vm-modules, and enabling that flag repo-wide to
  // test one function is a bad trade. Verified out-of-band instead — the deck
  // writes a 139 KB PK-magic zip containing ppt/slides/slide1..5.xml and
  // ppt/charts/chart1.xml. The same write() call already ships in the UC-005
  // export path, so it is exercised in production either way.
  test('is exported as a function alongside the deck builder', () => {
    expect(typeof realPptxService.generateAdminCostPptx).toBe('function');
    expect(typeof realPptxService.buildAdminCostDeck).toBe('function');
  });

  test('the deck it writes is a writable presentation with all five slides', () => {
    const deck = realPptxService.buildAdminCostDeck(COST_DATA);

    expect(typeof deck.write).toBe('function');
    expect(deck.slides).toHaveLength(5);
  });

  test('the UC-005 dashboard deck builder is untouched', () => {
    expect(typeof realPptxService.buildDashboardDeck).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 2. Endpoint — POST /api/export/admin-costs-pptx
// ---------------------------------------------------------------------------

describe(`POST ${PATH} — access control`, () => {
  test('401 without a token', async () => {
    const res = await request(app).post(PATH).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('401 with an invalid token', async () => {
    const res = await request(app).post(PATH).set('Authorization', 'Bearer nope').send({});
    expect(res.status).toBe(401);
  });

  test('403 for a manager — cost figures are admin-only here', async () => {
    const res = await request(app).post(PATH).set('Authorization', 'Bearer manager-token').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('403 for a resident', async () => {
    const res = await request(app).post(PATH).set('Authorization', 'Bearer resident-token').send({});
    expect(res.status).toBe(403);
  });

  test('403 for a suspended admin', async () => {
    const res = await request(app)
      .post(PATH)
      .set('Authorization', 'Bearer suspended-admin-token')
      .send({});
    expect(res.status).toBe(403);
  });

  test('a manager is refused before any deck is built', async () => {
    await request(app).post(PATH).set('Authorization', 'Bearer manager-token').send({});
    expect(pptxService.generateAdminCostPptx).not.toHaveBeenCalled();
    expect(cloudinaryService.uploadRaw).not.toHaveBeenCalled();
  });

  test('the UC-005 deck still admits a manager (unchanged)', async () => {
    const res = await request(app)
      .post('/api/export/pptx')
      .set('Authorization', 'Bearer manager-token')
      .send({ views: ['trends'] });
    expect(res.status).toBe(200);
  });
});

describe(`POST ${PATH} — behaviour`, () => {
  const post = (body = {}) =>
    request(app).post(PATH).set('Authorization', 'Bearer admin-token').send(body);

  test('200 with a Cloudinary .pptx URL for an admin', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pptx_url: 'https://res.cloudinary.com/demo/reports/admin-costs-1.pptx',
    });
  });

  test('the buffer is uploaded as a raw .pptx into the reports folder', async () => {
    await post();

    const [buffer, folder, filename] = cloudinaryService.uploadRaw.mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(folder).toBe('reports');
    expect(filename).toMatch(/^admin-costs-\d+\.pptx$/);
  });

  test('the deck is built from the live cost fetchers, not canned data', async () => {
    await post();

    const [costData] = pptxService.generateAdminCostPptx.mock.calls[0];
    expect(costData.summary).toEqual({
      total_actual: 3000,
      total_projected: 3600,
      variance_pct: 20,
      jobs: 4,
    });
    expect(costData.byCategory).toEqual([{ category: 'Doors', actual: 2000, projected: 2400 }]);
    expect(costData.byBlock).toEqual([{ block: '44A', actual: 2000, projected: 2400 }]);
    expect(costData.byContractor).toEqual([
      { name: 'Otis Service SG', total: 2000, count: 3 },
    ]);
  });

  test('body filters are validated and passed through to the fetchers', async () => {
    await post({ filters: { block: '44A', startDate: '2026-01-01' } });

    const [costData] = pptxService.generateAdminCostPptx.mock.calls[0];
    expect(costData.filters).toEqual({ block: '44A', startDate: '2026-01-01' });

    // and they actually reached the SQL
    const [, params] = mockQuery.mock.calls.find(([sql]) => /AS total_actual/i.test(sql));
    expect(params).toEqual(['2026-01-01', '44A']);
  });

  test('query-string filters work too', async () => {
    const res = await request(app)
      .post(`${PATH}?block=44B`)
      .set('Authorization', 'Bearer admin-token')
      .send({});

    expect(res.status).toBe(200);
    const [costData] = pptxService.generateAdminCostPptx.mock.calls[0];
    expect(costData.filters).toEqual({ block: '44B' });
  });

  test('a body filter overrides the same query param', async () => {
    await request(app)
      .post(`${PATH}?block=44B`)
      .set('Authorization', 'Bearer admin-token')
      .send({ filters: { block: '44A' } });

    const [costData] = pptxService.generateAdminCostPptx.mock.calls[0];
    expect(costData.filters.block).toBe('44A');
  });

  test('projections_suppressed is set when a lift filter is applied', async () => {
    await post({ filters: { liftId: '11111111-2222-3333-4444-555555555555' } });

    const [costData] = pptxService.generateAdminCostPptx.mock.calls[0];
    expect(costData.projections_suppressed).toBe(true);
  });

  test('projections_suppressed is false for a plain block filter', async () => {
    await post({ filters: { block: '44A' } });

    const [costData] = pptxService.generateAdminCostPptx.mock.calls[0];
    expect(costData.projections_suppressed).toBe(false);
  });

  test.each([
    ['startDate', { startDate: '2026-02-30' }, /startDate must be a real calendar date/],
    ['liftId', { liftId: 'not-a-uuid' }, /liftId must be a valid UUID/],
    ['range', { startDate: '2026-06-01', endDate: '2026-05-01' }, /must not be after endDate/],
  ])('400 VALIDATION_ERROR for a bad %s', async (_label, filters, messageRe) => {
    const res = await post({ filters });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(messageRe);
    // rejected before any deck build or upload
    expect(pptxService.generateAdminCostPptx).not.toHaveBeenCalled();
    expect(cloudinaryService.uploadRaw).not.toHaveBeenCalled();
  });

  test('an empty body is fine — it means "no filters"', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(pptxService.generateAdminCostPptx.mock.calls[0][0].filters).toEqual({});
  });

  test('500 EXPORT_FAILED when the deck build throws', async () => {
    pptxService.generateAdminCostPptx.mockRejectedValueOnce(new Error('boom'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('EXPORT_FAILED');
    expect(res.body.message).toMatch(/CSV/); // the UI's fallback hint
  });

  test('500 EXPORT_FAILED when the Cloudinary upload throws', async () => {
    cloudinaryService.uploadRaw.mockRejectedValueOnce(new Error('cloudinary down'));

    const res = await post();

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('EXPORT_FAILED');
  });

  test('500 EXPORT_FAILED when a cost query fails, and no upload is attempted', async () => {
    mockQuery.mockImplementationOnce(async (sql, params = []) => {
      const p = profiles[params[0]];
      return { rows: p ? [p] : [] };
    });
    mockQuery.mockImplementationOnce(async () => {
      throw new Error('connection lost');
    });

    const res = await post();

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('EXPORT_FAILED');
    expect(cloudinaryService.uploadRaw).not.toHaveBeenCalled();
  });
});
