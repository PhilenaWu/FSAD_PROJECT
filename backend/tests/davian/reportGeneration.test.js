// Unit tests for UC-009 Phase 1 (data -> summary -> PDF). No live services:
// config/db is mocked so getReportData runs against sample inspection/prediction
// data, and config/env is mocked so OPENAI_API_KEY reads as unset regardless of
// the real .env — generateExecutiveSummary must take its deterministic fallback
// path here (no real OpenAI call), which a real key in .env would otherwise
// override. generateMonthlyReportPDF runs against the real pdfkit (in-memory only).
'use strict';

jest.mock('../../src/config/env', () => ({ OPENAI_API_KEY: undefined }));

// --- Mock the pg layer. Dispatch on SQL shape; each test sets `responses`. ---
let responses;
const mockQuery = jest.fn(async (sql) => {
  if (/ai_predictions/.test(sql)) return { rows: [responses.prediction] };
  if (/HAVING COUNT/.test(sql)) return { rows: responses.recurring };
  if (/AVG\(EXTRACT/.test(sql)) return { rows: [responses.scalar] };
  if (/SUM\(actual_cost\)/.test(sql)) return { rows: [responses.cost] };
  if (/GROUP BY status/.test(sql)) return { rows: responses.status };
  if (/GROUP BY location_block/.test(sql)) return { rows: responses.block };
  if (/GROUP BY category/.test(sql)) return { rows: responses.category };
  return { rows: [] };
});
jest.mock('../../src/config/db', () => ({ query: (...args) => mockQuery(...args) }));

const reportModel = require('../../src/models/reportModel');
const pdfService = require('../../src/services/pdfService');
const openaiService = require('../../src/services/openaiService');

// A fully-populated sample period.
function populated() {
  return {
    scalar: {
      total: 10,
      avg_rectification_hours: 48, // 2 days
      sla_compliant: 7,
      sla_eligible: 10,
    },
    cost: { actual_cost_total: 5000 },
    status: [
      { status: 'Closed', count: 6 },
      { status: 'Open', count: 4 },
    ],
    category: [
      { category: 'Lift', count: 5 },
      { category: 'Plumbing', count: 3 },
      { category: 'Electrical', count: 2 },
    ],
    block: [
      { block: '44A', count: 6 },
      { block: '88B', count: 4 },
    ],
    recurring: [
      { category: 'Lift', block: '44A', count: 4 },
      { category: 'Plumbing', block: '88B', count: 2 },
    ],
    prediction: { estimated_cost_total: 1500 },
  };
}

// An empty period: no inspections created in the window, so counts are zero and
// breakdowns empty.
function empty() {
  return {
    scalar: {
      total: 0,
      avg_rectification_hours: null,
      sla_compliant: 0,
      sla_eligible: 0,
    },
    cost: { actual_cost_total: 0 },
    status: [],
    category: [],
    block: [],
    recurring: [],
    prediction: { estimated_cost_total: 0 },
  };
}

const START = '2026-06-24T00:00:00.000Z';
const END = '2026-07-24T00:00:00.000Z';

beforeEach(() => {
  mockQuery.mockClear();
});

describe('reportModel.getReportData — aggregation', () => {
  test('computes totals, averages, SLA %, and costs from the sample data', async () => {
    responses = populated();
    const data = await reportModel.getReportData(START, END);

    expect(data.period).toEqual({ startDate: START, endDate: END });
    expect(data.totalDefects).toBe(10);

    // breakdowns are passed through
    expect(data.byStatus).toEqual(responses.status);
    expect(data.byCategory).toEqual(responses.category);
    expect(data.byBlock).toEqual(responses.block);
    expect(data.topRecurringDefects).toEqual(responses.recurring);

    // average rectification: 48h -> 2 days
    expect(data.avgRectification.hours).toBe(48);
    expect(data.avgRectification.days).toBe(2);

    // SLA: 7 / 10 = 70%
    expect(data.sla).toEqual({ compliant: 7, eligible: 10, compliancePct: 70 });

    // costs: actual 5000 + estimated 1500 = 6500 projected
    expect(data.costs).toEqual({ actual: 5000, estimated: 1500, projected: 6500 });
  });

  test('SLA compliance percentage rounds to one decimal', async () => {
    responses = populated();
    responses.scalar.sla_compliant = 2;
    responses.scalar.sla_eligible = 3; // 66.666...
    const data = await reportModel.getReportData(START, END);
    expect(data.sla.compliancePct).toBe(66.7);
  });

  test('includes closed records and uses bound params (no interpolation)', async () => {
    responses = populated();
    await reportModel.getReportData(START, END);

    for (const [sql, params] of mockQuery.mock.calls) {
      if (/FROM inspections/.test(sql)) {
        // No is_deleted filter. The flag is written only by the manual close and
        // the G6 zero-defect auto-file, so it marks a record as archived, not
        // deleted, and is TRUE for every Closed record. Filtering it dropped all
        // completed work: byStatus could never show 'Closed', totalDefects
        // undercounted, and the cost query (status = 'Closed' AND
        // is_deleted = FALSE) was unsatisfiable, so actual spend was always $0.
        expect(sql).not.toMatch(/is_deleted/);
        // Window is bound to $1/$2 on either created_at (most queries) or
        // closed_at (the actual-cost query).
        expect(sql).toMatch(/(created_at|closed_at) >= \$1 AND (created_at|closed_at) < \$2/);
        expect(params).toEqual([START, END]);
        expect(sql).not.toContain(START);
      }
    }
  });

  test('SLA compliance calculated as rectified_at <= target_deadline', async () => {
    responses = populated();
    await reportModel.getReportData(START, END);
    const scalarCall = mockQuery.mock.calls.find(([sql]) => /AVG\(EXTRACT/.test(sql));
    expect(scalarCall[0]).toMatch(/rectified_at <= target_deadline/);
  });

  test('actual cost sums closed work by closed_at within the period', async () => {
    responses = populated();
    await reportModel.getReportData(START, END);
    const costCall = mockQuery.mock.calls.find(([sql]) => /SUM\(actual_cost\)/.test(sql));
    expect(costCall[0]).toMatch(/status = 'Closed'/);
    expect(costCall[0]).toMatch(/actual_cost IS NOT NULL/);
    // keyed on closed_at (cost realized at closure), not created_at
    expect(costCall[0]).toMatch(/closed_at >= \$1 AND closed_at < \$2/);
    expect(costCall[0]).not.toMatch(/created_at/);
  });

  test('estimated cost sums estimated_cost of active predictions', async () => {
    responses = populated();
    await reportModel.getReportData(START, END);
    const predCall = mockQuery.mock.calls.find(([sql]) => /ai_predictions/.test(sql));
    expect(predCall[0]).toMatch(/SUM\(estimated_cost\)/);
    expect(predCall[0]).toMatch(/status = 'Active'/);
  });
});

describe('reportModel.getReportData — edge cases', () => {
  test('no data in the period: zero totals, empty breakdowns, null average, 0% SLA', async () => {
    responses = empty();
    const data = await reportModel.getReportData(START, END);

    expect(data.totalDefects).toBe(0);
    expect(data.byStatus).toEqual([]);
    expect(data.byCategory).toEqual([]);
    expect(data.byBlock).toEqual([]);
    expect(data.topRecurringDefects).toEqual([]);
    expect(data.avgRectification).toEqual({ hours: null, days: null });
    expect(data.sla).toEqual({ compliant: 0, eligible: 0, compliancePct: 0 });
    expect(data.costs).toEqual({ actual: 0, estimated: 0, projected: 0 });
  });

  test('all records deleted behaves like an empty period (no divide-by-zero)', async () => {
    responses = empty();
    const data = await reportModel.getReportData(START, END);
    expect(data.sla.compliancePct).toBe(0);
    expect(Number.isFinite(data.sla.compliancePct)).toBe(true);
  });

  test('propagates a database failure', async () => {
    responses = populated();
    mockQuery.mockImplementationOnce(async () => {
      throw new Error('connection refused');
    });
    await expect(reportModel.getReportData(START, END)).rejects.toThrow('connection refused');
  });
});

describe('openaiService.generateExecutiveSummary — fallback (no API key)', () => {
  test('produces a data-driven summary with volume, SLA % and a recommendation', async () => {
    responses = populated();
    const data = await reportModel.getReportData(START, END);
    const summary = await openaiService.generateExecutiveSummary(data);

    expect(typeof summary).toBe('string');
    expect(summary).toMatch(/10 defect/);
    expect(summary).toMatch(/70% SLA compliance/);
    expect(summary).toMatch(/Recommendation:/);
    // detailed but bounded — cost outlook is included
    expect(summary).toMatch(/\$5,000/); // actual spend
    expect(summary).toMatch(/total exposure/i);
    expect(summary.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(200);
  });

  test('handles an empty period without throwing', async () => {
    responses = empty();
    const data = await reportModel.getReportData(START, END);
    const emptySummary = await openaiService.generateExecutiveSummary(data);
    expect(emptySummary).toMatch(/0 defect/);
    expect(emptySummary).toMatch(/0% SLA compliance/);
    expect(emptySummary).toMatch(/No defects were rectified/);
  });
});

describe('pdfService.generateMonthlyReportPDF', () => {
  test('returns a non-empty PDF Buffer for a populated report', async () => {
    responses = populated();
    const data = await reportModel.getReportData(START, END);
    const summary = await openaiService.generateExecutiveSummary(data);

    const buf = await pdfService.generateMonthlyReportPDF(data, summary);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // valid PDF header
    expect(buf.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  test('returns a valid Buffer even when the period has no data', async () => {
    responses = empty();
    const data = await reportModel.getReportData(START, END);
    const summary = await openaiService.generateExecutiveSummary(data);

    const buf = await pdfService.generateMonthlyReportPDF(data, summary);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
