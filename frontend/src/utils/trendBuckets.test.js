// Tests for the UC-005 trend bucketing — the axis has to stay linear in time
// at every range, which is the bug these guard against.
import { describe, expect, test } from 'vitest';
import { bucketTrend } from './trendBuckets';

const row = (date, count) => ({ date, count });

describe('bucketTrend', () => {
  test('a short range stays daily and fills the gaps', () => {
    // Three reports over five days, with two silent days in between.
    const { granularity, labels, series } = bucketTrend([
      [row('2026-03-01', 2), row('2026-03-04', 1)],
    ]);

    expect(granularity).toBe('day');
    // The silent days are real points, not collapsed away.
    expect(labels).toEqual(['03-01', '03-02', '03-03', '03-04']);
    expect(series[0]).toEqual([2, 0, 0, 1]);
  });

  test('a quiet stretch occupies its real width, not one slot', () => {
    // The original bug: these two days sat side by side on the axis, making a
    // five-week gap look like a single step.
    const { granularity, series } = bucketTrend([
      [row('2026-01-05', 1), row('2026-02-10', 1)],
    ]);

    expect(granularity).toBe('day'); // 36 days — still inside the daily window
    expect(series[0]).toHaveLength(37);
    expect(series[0].filter((n) => n === 0)).toHaveLength(35);
  });

  test('a mid-length range switches to weeks, keyed to the Monday', () => {
    const { granularity, keys } = bucketTrend([
      [row('2026-01-01', 1), row('2026-04-15', 1)],
    ]);

    expect(granularity).toBe('week');
    // 2026-01-01 is a Thursday; its week starts Monday 2025-12-29.
    expect(keys[0]).toBe('2025-12-29');
    keys.forEach((k) => expect(new Date(`${k}T00:00:00Z`).getUTCDay()).toBe(1));
  });

  test('a year of history collapses to months', () => {
    const { granularity, keys, labels } = bucketTrend([
      [row('2025-07-15', 3), row('2026-07-20', 5)],
    ]);

    expect(granularity).toBe('month');
    expect(keys).toHaveLength(13); // Jul 2025 … Jul 2026 inclusive
    expect(keys[0]).toBe('2025-07');
    expect(labels[0]).toBe('Jul 25');
  });

  test('counts inside a bucket are summed, never averaged or dropped', () => {
    const { granularity, series } = bucketTrend([
      [row('2025-08-02', 4), row('2025-08-19', 6), row('2026-08-01', 1)],
    ]);

    expect(granularity).toBe('month');
    expect(series[0][0]).toBe(10); // both August 2025 days land in one bucket
  });

  test('both series share one axis so the preview line stays comparable', () => {
    const { labels, series } = bucketTrend([
      [row('2026-03-01', 2)],
      [row('2026-03-03', 5)],
    ]);

    expect(labels).toEqual(['03-01', '03-02', '03-03']);
    expect(series[0]).toEqual([2, 0, 0]);
    expect(series[1]).toEqual([0, 0, 5]);
  });

  test('an empty series yields an empty axis rather than throwing', () => {
    expect(bucketTrend([[], []])).toEqual({
      granularity: 'day',
      keys: [],
      labels: [],
      tooltips: [],
      series: [[], []],
    });
    expect(bucketTrend([]).labels).toEqual([]);
  });

  test('tooltips name the period so a monthly point is never read as a day', () => {
    const monthly = bucketTrend([[row('2025-07-15', 1), row('2026-07-20', 1)]]);
    expect(monthly.tooltips[0]).toBe('July 2025');

    const weekly = bucketTrend([[row('2026-01-01', 1), row('2026-04-15', 1)]]);
    expect(weekly.tooltips[0]).toBe('Week of 2025-12-29');

    const daily = bucketTrend([[row('2026-03-01', 1), row('2026-03-04', 1)]]);
    expect(daily.tooltips[0]).toBe('2026-03-01');
  });

  test('a date is bucketed by its UTC day, not the local one', () => {
    // Parsed with the local zone, 2026-03-01 slips to Feb 28 west of
    // Greenwich and the first bucket silently shifts.
    const { keys } = bucketTrend([[row('2026-03-01', 1), row('2026-03-02', 1)]]);
    expect(keys[0]).toBe('2026-03-01');
  });
});
