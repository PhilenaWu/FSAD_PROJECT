// Tests for the UC-003 "My reports" rules: which live updates apply to me,
// what a closure does to the lists, and when a rating may be offered.
// Run with `npm test` (vitest).
import { describe, expect, test } from 'vitest';
import {
  applyEdit,
  applyStatusUpdate,
  groupBySection,
  isEditable,
} from './myReports';

const MINE = { id: 'insp-1', status: 'Assigned', priority: 'Medium', updated_at: '2026-07-01T00:00:00Z' };
const ALSO_MINE = { id: 'insp-2', status: 'Open', priority: 'Low', updated_at: '2026-07-02T00:00:00Z' };

describe('applyStatusUpdate', () => {
  test('patches a record of mine in place', () => {
    const { reports, outcome } = applyStatusUpdate([MINE, ALSO_MINE], {
      id: 'insp-1',
      status: 'Acknowledged',
      priority: 'High',
      updated_at: '2026-07-03T00:00:00Z',
    });

    expect(outcome).toBe('updated');
    expect(reports[0]).toMatchObject({
      status: 'Acknowledged',
      priority: 'High',
      updated_at: '2026-07-03T00:00:00Z',
    });
    expect(reports[1]).toBe(ALSO_MINE); // untouched
  });

  test("ignores a neighbour's report — the block room carries those too", () => {
    const list = [MINE];
    const { reports, outcome } = applyStatusUpdate(list, {
      id: 'someone-elses',
      status: 'Closed',
    });

    expect(outcome).toBe('ignored');
    expect(reports).toBe(list);
  });

  test('a closure drops the record from the live list', () => {
    const { reports, outcome } = applyStatusUpdate([MINE, ALSO_MINE], {
      id: 'insp-1',
      status: 'Closed',
    });

    expect(outcome).toBe('closed');
    expect(reports.map((r) => r.id)).toEqual(['insp-2']);
  });

  test('keeps existing values for fields the event omits', () => {
    const { reports } = applyStatusUpdate([MINE], { id: 'insp-1', status: 'On Hold' });

    expect(reports[0].priority).toBe('Medium');
    expect(reports[0].updated_at).toBe('2026-07-01T00:00:00Z');
  });

  test('never mutates the list it is given', () => {
    const list = [MINE];
    applyStatusUpdate(list, { id: 'insp-1', status: 'Rectified' });

    expect(list[0].status).toBe('Assigned');
  });

  test('tolerates a malformed payload', () => {
    const list = [MINE];
    for (const payload of [undefined, null, {}, { status: 'Closed' }]) {
      expect(applyStatusUpdate(list, payload)).toEqual({ reports: list, outcome: 'ignored' });
    }
  });
});

describe('isEditable', () => {
  test('a report filed moments ago is editable', () => {
    expect(isEditable({ created_at: new Date().toISOString() })).toBe(true);
  });

  test('a report filed over 30 minutes ago is not', () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    expect(isEditable({ created_at: old })).toBe(false);
  });

  test('right at the boundary (29 minutes) is still editable', () => {
    const almostExpired = new Date(Date.now() - 29 * 60 * 1000).toISOString();
    expect(isEditable({ created_at: almostExpired })).toBe(true);
  });
});

describe('applyEdit', () => {
  test('merges the updated fields onto the matching record only', () => {
    const next = applyEdit([MINE, ALSO_MINE], 'insp-1', { title: 'New title', category: 'Plumbing' });

    expect(next[0]).toMatchObject({ title: 'New title', category: 'Plumbing', status: 'Assigned' });
    expect(next[1]).toBe(ALSO_MINE);
  });

  test('leaves the list alone when the id is not in it', () => {
    const next = applyEdit([MINE], 'nope', { title: 'x' });
    expect(next[0]).toBe(MINE);
  });
});

describe('groupBySection', () => {
  test('folds results into sections, preserving the order given', () => {
    const grouped = groupBySection([
      { id: 'a', section: 'A — Motor Room' },
      { id: 'b', section: 'A — Motor Room' },
      { id: 'c', section: 'B — Lift Car' },
    ]);

    expect(grouped.map(([section]) => section)).toEqual(['A — Motor Room', 'B — Lift Car']);
    expect(grouped[0][1].map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('is empty for a complaint with no checklist', () => {
    expect(groupBySection([])).toEqual([]);
  });
});
