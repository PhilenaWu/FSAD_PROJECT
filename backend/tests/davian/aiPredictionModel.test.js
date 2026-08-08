// Unit tests for aiPredictionModel (UC-006). Mocks config/db.query so no live
// database is needed; asserts the SQL/params sent to pg and the returned rows.
'use strict';

const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({ query: mockQuery }));

const aiPredictionModel = require('../../src/models/aiPredictionModel');

beforeEach(() => {
  mockQuery.mockReset();
});

describe('aiPredictionModel.insert', () => {
  test('inserts with all fields as bound params and returns the row', async () => {
    const row = { id: 'pred-1', location_block: '44A', category: 'Lift' };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await aiPredictionModel.insert({
      location_block: '44A',
      category: 'Lift',
      velocity_pct: 150,
      estimated_cost: 1200,
      alert_text: 'Lift defects rising.',
    });

    expect(result).toBe(row);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO ai_predictions/i);
    expect(params).toEqual(['44A', 'Lift', 150, 1200, 'Lift defects rising.']);
  });

  test('defaults estimated_cost to null when omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pred-2' }] });

    await aiPredictionModel.insert({
      location_block: '10B',
      category: 'Electrical',
      velocity_pct: 60,
      alert_text: 'Electrical faults rising.',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBeNull();
  });
});

describe('aiPredictionModel.updateStatus', () => {
  test("dismiss stamps dismissed_by/at (isDismiss flag true, managerId passed)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', status: 'Dismissed' }] });

    const result = await aiPredictionModel.updateStatus('p1', 'Dismissed', 'mgr-1');

    expect(result).toEqual({ id: 'p1', status: 'Dismissed' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE ai_predictions/i);
    expect(sql).toMatch(/dismissed_at = CASE WHEN/i);
    expect(params).toEqual(['p1', 'Dismissed', true, 'mgr-1']);
  });

  test('accept does not flag a dismissal (isDismiss false)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', status: 'Accepted' }] });

    await aiPredictionModel.updateStatus('p1', 'Accepted', 'mgr-1');

    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(false);
  });

  test('returns undefined when no row matches the id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await aiPredictionModel.updateStatus('missing', 'Accepted', 'mgr-1');
    expect(result).toBeUndefined();
  });
});

describe('aiPredictionModel.list', () => {
  test('defaults to Active and filters by status param', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a', status: 'Active' }] });

    const rows = await aiPredictionModel.list();

    expect(rows).toHaveLength(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE status = \$1/);
    expect(params).toEqual(['Active']);
  });

  test("status 'all' omits the WHERE clause and passes no params", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await aiPredictionModel.list('all');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/WHERE/);
    expect(params).toEqual([]);
  });
});
