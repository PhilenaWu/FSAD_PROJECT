// Unit tests for the UC-006 orchestration in recommendationController. All I/O
// is mocked: config/db.query, velocityCalculator, openaiService, and
// aiPredictionModel. Controllers are called directly with fake req/res/next.
'use strict';

const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({ query: mockQuery }));

const mockCalculateVelocity = jest.fn();
jest.mock('../../src/utils/velocityCalculator', () => ({
  calculateVelocity: mockCalculateVelocity,
}));

const mockGenerateRiskAlert = jest.fn(async () => 'ALERT TEXT');
jest.mock('../../src/services/openaiService', () => ({
  generateRiskAlert: mockGenerateRiskAlert,
}));

const mockInsert = jest.fn(async (data) => ({ id: 'pred-new', ...data }));
const mockUpdateStatus = jest.fn();
const mockList = jest.fn();
jest.mock('../../src/models/aiPredictionModel', () => ({
  insert: mockInsert,
  updateStatus: mockUpdateStatus,
  list: mockList,
}));

// Socket.IO emit seam — acceptAlert notifies 'manager-room' when it opens the
// follow-up inspection, and getIO() throws with no server running in tests.
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

const controller = require('../../src/controllers/recommendationController');

// --- helpers ------------------------------------------------------------
function makeRes() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

// Route db.query by SQL. Callers set `jobs`, `scanPairs`, `avgCost` first.
let jobs;
let scanPairs;
let avgCost;
function routeQuery(sql) {
  if (/FROM ai_jobs/i.test(sql) && /pending/i.test(sql)) return { rows: jobs };
  if (/UPDATE ai_jobs/i.test(sql)) return { rows: [] };
  if (/GROUP BY location_block, category/i.test(sql)) return { rows: scanPairs };
  if (/AVG\(actual_cost\)/i.test(sql)) return { rows: [{ avg_cost: avgCost }] };
  if (/INSERT INTO inspections/i.test(sql)) return { rows: [{ id: 'insp-new' }] };
  return { rows: [] };
}

// eligible = velocity read that clears the 40% threshold.
const eligible = (pct) => ({ velocity_pct: pct, is_eligible: true, reason: null });
const ineligible = () => ({ velocity_pct: 0, is_eligible: false, reason: 'INSUFFICIENT_CURRENT_DATA' });

beforeEach(() => {
  jest.clearAllMocks();
  jobs = [];
  scanPairs = [];
  avgCost = null;
  mockQuery.mockImplementation(async (sql) => routeQuery(sql));
});

describe('runAnalysis — ai_jobs priority', () => {
  test('processes pending ai_jobs first, then marks them processed', async () => {
    jobs = [{ id: 'job-1', location_block: '44A', category: 'Lift' }];
    scanPairs = [{ location_block: '10B', category: 'Electrical' }];
    mockCalculateVelocity.mockResolvedValue(ineligible());

    const res = makeRes();
    await controller.runAnalysis({}, res, jest.fn());

    // Job pair evaluated before the scan pair.
    expect(mockCalculateVelocity.mock.calls[0].slice(0, 2)).toEqual(['44A', 'Lift']);
    expect(mockCalculateVelocity.mock.calls[1].slice(0, 2)).toEqual(['10B', 'Electrical']);

    // ai_jobs drained.
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE ai_jobs/i.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual([['job-1']]);

    expect(res.json.mock.calls[0][0].jobs_processed).toBe(1);
  });

  test('a pair present in both ai_jobs and the scan is evaluated only once', async () => {
    jobs = [{ id: 'job-1', location_block: '44A', category: 'Lift' }];
    scanPairs = [{ location_block: '44A', category: 'Lift' }];
    mockCalculateVelocity.mockResolvedValue(ineligible());

    await controller.runAnalysis({}, makeRes(), jest.fn());

    expect(mockCalculateVelocity).toHaveBeenCalledTimes(1);
  });
});

describe('runAnalysis — general scan & threshold', () => {
  test('generates alerts only for eligible pairs at/above 40%', async () => {
    scanPairs = [
      { location_block: 'A', category: 'Lift' }, // 150% -> alert
      { location_block: 'B', category: 'Doors' }, // 30% -> skip
      { location_block: 'C', category: 'Safety' }, // ineligible -> skip
    ];
    mockCalculateVelocity
      .mockResolvedValueOnce(eligible(150))
      .mockResolvedValueOnce(eligible(30))
      .mockResolvedValueOnce(ineligible());

    const res = makeRes();
    await controller.runAnalysis({}, res, jest.fn());

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ location_block: 'A', category: 'Lift', velocity_pct: 150 });

    const body = res.json.mock.calls[0][0];
    expect(body.alerts_generated).toBe(1);
    expect(body.skipped).toHaveLength(2);
  });

  test('exactly 40% is alertable (threshold is inclusive)', async () => {
    scanPairs = [{ location_block: 'A', category: 'Lift' }];
    mockCalculateVelocity.mockResolvedValueOnce(eligible(40));

    await controller.runAnalysis({}, makeRes(), jest.fn());

    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  test('no data: insufficient-history pairs are skipped with no alert', async () => {
    scanPairs = [{ location_block: 'A', category: 'Lift' }];
    mockCalculateVelocity.mockResolvedValueOnce(ineligible());

    const res = makeRes();
    await controller.runAnalysis({}, res, jest.fn());

    expect(mockInsert).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].alerts_generated).toBe(0);
  });
});

describe('runAnalysis — estimated cost', () => {
  test('estimated_cost = avg actual_cost × 1, rounded, and stored', async () => {
    scanPairs = [{ location_block: 'A', category: 'Lift' }];
    avgCost = 1234.567;
    mockCalculateVelocity.mockResolvedValueOnce(eligible(150));

    await controller.runAnalysis({}, makeRes(), jest.fn());

    expect(mockInsert.mock.calls[0][0].estimated_cost).toBe(1234.57);
    // and the same figure is passed to the alert generator
    expect(mockGenerateRiskAlert).toHaveBeenCalledWith('A', 'Lift', 150, 1234.57);
  });

  test('estimated_cost is null when there is no cost history', async () => {
    scanPairs = [{ location_block: 'A', category: 'Lift' }];
    avgCost = null;
    mockCalculateVelocity.mockResolvedValueOnce(eligible(150));

    await controller.runAnalysis({}, makeRes(), jest.fn());

    expect(mockInsert.mock.calls[0][0].estimated_cost).toBeNull();
  });
});

describe('runAnalysis — OpenAI fallback', () => {
  test('uses whatever text the (graceful) generator returns as alert_text', async () => {
    scanPairs = [{ location_block: 'A', category: 'Lift' }];
    mockCalculateVelocity.mockResolvedValueOnce(eligible(150));
    mockGenerateRiskAlert.mockResolvedValueOnce('FALLBACK TEMPLATE TEXT');

    await controller.runAnalysis({}, makeRes(), jest.fn());

    expect(mockInsert.mock.calls[0][0].alert_text).toBe('FALLBACK TEMPLATE TEXT');
  });
});

describe('acceptAlert', () => {
  test("sets status Accepted and opens an AI-Generated inspection", async () => {
    mockUpdateStatus.mockResolvedValueOnce({
      id: 'pred-1',
      location_block: '44A',
      category: 'Lift',
      velocity_pct: 150,
      estimated_cost: 1200,
      status: 'Accepted',
    });

    const res = makeRes();
    await controller.acceptAlert({ params: { id: 'pred-1' }, user: { id: 'mgr-1' } }, res, jest.fn());

    expect(mockUpdateStatus).toHaveBeenCalledWith('pred-1', 'Accepted', 'mgr-1');

    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO inspections/i.test(sql));
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toMatch(/'AI-Generated'/); // source_flag
    expect(insertCall[0]).toMatch(/'Open'/); // status
    expect(insertCall[1]).toEqual(['Preventive maintenance — Lift (Block 44A)', expect.stringContaining('150%'), '44A', 'Lift']);

    expect(res.json).toHaveBeenCalledWith({
      prediction_id: 'pred-1',
      status: 'Accepted',
      inspection_id: 'insp-new',
    });
  });

  test('404 when the prediction id is unknown', async () => {
    mockUpdateStatus.mockResolvedValueOnce(undefined);
    const next = jest.fn();

    await controller.acceptAlert({ params: { id: 'nope' }, user: { id: 'mgr-1' } }, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }));
    // no inspection created on the failure path
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO inspections/i.test(sql))).toBe(false);
  });
});

describe('dismissAlert', () => {
  test('sets status Dismissed and logs the manager id', async () => {
    mockUpdateStatus.mockResolvedValueOnce({ id: 'pred-1', status: 'Dismissed' });

    const res = makeRes();
    await controller.dismissAlert({ params: { id: 'pred-1' }, user: { id: 'mgr-9' } }, res, jest.fn());

    expect(mockUpdateStatus).toHaveBeenCalledWith('pred-1', 'Dismissed', 'mgr-9');
    expect(res.json).toHaveBeenCalledWith({ prediction_id: 'pred-1', status: 'Dismissed' });
  });

  test('404 when the prediction id is unknown', async () => {
    mockUpdateStatus.mockResolvedValueOnce(undefined);
    const next = jest.fn();

    await controller.dismissAlert({ params: { id: 'nope' }, user: { id: 'mgr-9' } }, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});
