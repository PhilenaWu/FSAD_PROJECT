// Unit tests for the UC-001 inspection model, below the HTTP layer.
//
// inspections.integration.test.js drives these paths through Express; this file
// pins the SQL and the bound parameters directly, because the model is where
// the defaults and the NOT NULL columns are decided. A default that silently
// became undefined would bind as NULL and violate the column constraint — a
// failure the integration tests see only as a 500, if at all.
//
// Only the pg pool is mocked; the model's own logic is real.
'use strict';

const mockQuery = jest.fn();

jest.mock('../../src/config/db', () => ({
  query: (...args) => mockQuery(...args),
  pool: { connect: jest.fn() },
  testConnection: jest.fn(),
}));

const inspectionModel = require('../../src/models/inspectionModel');
const { onHoldSql } = require('../../src/utils/onHold');

// The INSERT binds 16 columns in this order; the assertions below index it.
const COL = {
  source_type: 0,
  resident_id: 1,
  title: 2,
  description: 3,
  location_block: 4,
  location_unit: 5,
  photo_url: 6,
  category: 7,
  priority: 8,
  ai_priority_score: 9,
  source_flag: 10,
  cv_detection_id: 11,
  gps_lat: 12,
  gps_lng: 13,
  gps_accuracy_m: 14,
  gps_captured_at: 15,
};

const MINIMAL = {
  resident_id: 'res-1',
  title: 'Lift door not closing',
  description: 'Judders halfway.',
  location_block: '44A',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ id: 'insp-1' }] });
});

describe('inspectionModel.create — the resident complaint path (UC-001)', () => {
  test('inserts into inspections and returns the created row', async () => {
    const row = await inspectionModel.create(MINIMAL);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO inspections/i);
    expect(sql).toMatch(/RETURNING \*/i);
    expect(row).toEqual({ id: 'insp-1' });
  });

  test('binds the report fields it was given, in the column order of the INSERT', async () => {
    await inspectionModel.create({ ...MINIMAL, location_unit: '#12-05' });

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toHaveLength(16);
    expect(params[COL.resident_id]).toBe('res-1');
    expect(params[COL.title]).toBe('Lift door not closing');
    expect(params[COL.description]).toBe('Judders halfway.');
    expect(params[COL.location_block]).toBe('44A');
    expect(params[COL.location_unit]).toBe('#12-05');
  });

  // These four columns are NOT NULL. Because they are named explicitly in the
  // INSERT, the column DEFAULT can never apply — an omitted value would bind as
  // NULL and violate the constraint, so the defaults have to live in JS.
  test('applies the JS-side defaults the NOT NULL columns depend on', async () => {
    await inspectionModel.create(MINIMAL);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[COL.source_type]).toBe('resident_complaint');
    expect(params[COL.category]).toBe('Miscellaneous');
    expect(params[COL.priority]).toBe('Medium');
    expect(params[COL.source_flag]).toBe('Resident');
  });

  test('a caller-supplied category wins over the default', async () => {
    await inspectionModel.create({ ...MINIMAL, category: 'Plumbing' });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[COL.category]).toBe('Plumbing');
  });

  // The CV pipeline reuses this model for its own auto-detected tickets, which
  // are neither resident-filed nor 'Resident'-flagged.
  test('a CV-detected ticket overrides source_type and source_flag', async () => {
    await inspectionModel.create({
      ...MINIMAL,
      resident_id: undefined,
      source_type: 'cv_auto_detected',
      source_flag: 'Auto-Detected',
      cv_detection_id: 'cv-1',
      priority: 'Critical',
      ai_priority_score: 80,
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[COL.source_type]).toBe('cv_auto_detected');
    expect(params[COL.source_flag]).toBe('Auto-Detected');
    expect(params[COL.cv_detection_id]).toBe('cv-1');
    expect(params[COL.priority]).toBe('Critical');
    expect(params[COL.ai_priority_score]).toBe(80);
  });

  // GPS is supplementary: a report without it must still insert, binding NULL
  // rather than the string 'undefined'.
  test('omitted optional fields bind as undefined, never as a string', async () => {
    await inspectionModel.create(MINIMAL);

    const [, params] = mockQuery.mock.calls[0];
    for (const col of ['location_unit', 'photo_url', 'gps_lat', 'gps_lng', 'gps_accuracy_m', 'gps_captured_at']) {
      expect(params[COL[col]]).toBeUndefined();
    }
  });

  test('stores a GPS fix when the resident captured one', async () => {
    await inspectionModel.create({
      ...MINIMAL,
      gps_lat: '1.3521',
      gps_lng: '103.8198',
      gps_accuracy_m: '12',
      gps_captured_at: '2026-08-09T02:00:00.000Z',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[COL.gps_lat]).toBe('1.3521');
    expect(params[COL.gps_lng]).toBe('103.8198');
    expect(params[COL.gps_accuracy_m]).toBe('12');
    expect(params[COL.gps_captured_at]).toBe('2026-08-09T02:00:00.000Z');
  });
});

describe('inspectionModel.hasInspectorReview — the UC-004 close gate', () => {
  test('asks the audit trail for the inspector review row', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const reviewed = await inspectionModel.hasInspectorReview('insp-1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM inspection_history/i);
    expect(sql).toMatch(/action = 'Reviewed by Inspector'/);
    expect(params).toEqual(['insp-1']);
    expect(reviewed).toBe(true);
  });

  test('no such row means not reviewed — the close is refused', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(inspectionModel.hasInspectorReview('insp-1')).resolves.toBe(false);
  });
});

// A hold pauses the rectification clock (G11). It stopped being a status, so
// "held" is derived from the audit trail — and the overdue count and the chase
// email both filter on it.
describe('onHoldSql — the held-record predicate', () => {
  test('reads the latest hold/resume row for the given table alias', () => {
    const sql = onHoldSql('i');

    expect(sql).toMatch(/FROM inspection_history h/i);
    expect(sql).toMatch(/h\.inspection_id = i\.id/);
    expect(sql).toMatch(/action IN \('On Hold', 'Resumed'\)/);
    expect(sql).toMatch(/ORDER BY h\.created_at DESC, h\.id DESC/i);
    expect(sql).toMatch(/LIMIT 1/i);
  });

  test('defaults to the bare inspections table when no alias is given', () => {
    expect(onHoldSql()).toMatch(/h\.inspection_id = inspections\.id/);
  });

  // Without COALESCE the subquery is NULL for a record that was never held, and
  // `NOT (NULL = 'On Hold')` is NULL rather than true — which silently dropped
  // every never-held record out of the callers' NOT clauses.
  test('coalesces the empty case so NOT over it stays true', () => {
    const sql = onHoldSql();

    expect(sql).toMatch(/COALESCE\(/i);
    expect(sql.trim().startsWith('(')).toBe(true);
    expect(sql.trim().endsWith(')')).toBe(true);
  });
});
