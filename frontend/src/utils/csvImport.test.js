// Tests for the dashboard CSV what-if import — parsing, all three merges,
// and every rejection message. Run with `npm test` (vitest).
import { describe, expect, test } from 'vitest';
import {
  parseInspectionsCsv,
  mergeHeatmap,
  mergeTrends,
  mergeSla,
} from './csvImport';

const VALID_CSV = `block,category,date,resolution_time_hours
44A,Lift,2026-07-01,50
44A,Lift,2026-07-02,
99Z,Pest,2026-07-01,90`;

describe('parseInspectionsCsv', () => {
  test('parses valid rows with optional fields', () => {
    const rows = parseInspectionsCsv(VALID_CSV);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ block: '44A', category: 'Lift', date: '2026-07-01', resolution_time_hours: 50 });
    expect(rows[1].resolution_time_hours).toBeNull(); // blank hours = still open
  });

  test('accepts a minimal header (block,category only)', () => {
    const rows = parseInspectionsCsv('block,category\n44A,Lift');
    expect(rows[0]).toEqual({ block: '44A', category: 'Lift', date: null, resolution_time_hours: null });
  });

  test('rejects a wrong header', () => {
    expect(() => parseInspectionsCsv('foo,bar\n1,2')).toThrow(/must have "block" and "category"/);
  });

  test('rejects a header-only file', () => {
    expect(() => parseInspectionsCsv('block,category')).toThrow(/at least one data row/);
  });

  test('rejects a row missing block or category, naming the row', () => {
    expect(() => parseInspectionsCsv('block,category\n,Lift')).toThrow(/Row 2: block and category are required/);
  });

  test('rejects non-numeric resolution hours, naming the row', () => {
    expect(() =>
      parseInspectionsCsv('block,category,resolution_time_hours\n44A,Lift,soon')
    ).toThrow(/Row 2: resolution_time_hours must be a number/);
  });

  test('rejects a malformed date, naming the row', () => {
    expect(() =>
      parseInspectionsCsv('block,category,date\n44A,Lift,13/01/2026')
    ).toThrow(/Row 2: date must be YYYY-MM-DD/);
  });
});

describe('mergeHeatmap', () => {
  const base = [{ block: '44A', category: 'Lift', count: 5 }];
  const rows = parseInspectionsCsv(VALID_CSV);

  test('increments existing cells and adds new ones', () => {
    const merged = mergeHeatmap(base, rows);
    expect(merged).toEqual([
      { block: '44A', category: 'Lift', count: 7 },
      { block: '99Z', category: 'Pest', count: 1 },
    ]);
  });

  test('does not mutate the base data', () => {
    mergeHeatmap(base, rows);
    expect(base[0].count).toBe(5);
  });
});

describe('mergeTrends', () => {
  test('adds counts per date and sorts', () => {
    const rows = parseInspectionsCsv(VALID_CSV);
    const merged = mergeTrends([{ date: '2026-07-01', count: 1 }], rows);
    expect(merged).toEqual([
      { date: '2026-07-01', count: 3 },
      { date: '2026-07-02', count: 1 },
    ]);
  });

  test('skips rows without a date', () => {
    const merged = mergeTrends([], [{ block: '44A', category: 'Lift', date: null, resolution_time_hours: null }]);
    expect(merged).toEqual([]);
  });
});

describe('mergeSla', () => {
  const base = { compliant_count: 42, total_resolved: 55, sla_percentage: 76.36, sla_threshold_hrs: 72 };

  test('recomputes percentage with resolved imported rows', () => {
    const rows = parseInspectionsCsv(VALID_CSV); // 50h compliant, 90h breached, one open
    const merged = mergeSla(base, rows);
    expect(merged.compliant_count).toBe(43);
    expect(merged.total_resolved).toBe(57);
    expect(merged.sla_percentage).toBeCloseTo(75.44, 2);
  });

  test('returns the base unchanged when no imported rows are resolved', () => {
    const rows = [{ block: '44A', category: 'Lift', date: null, resolution_time_hours: null }];
    expect(mergeSla(base, rows)).toBe(base);
  });
});
