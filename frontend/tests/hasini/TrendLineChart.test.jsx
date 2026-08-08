// Tests for the UC-005 trend chart (components/analytics/TrendLineChart.jsx).
//
// react-chartjs-2 is mocked; the bucketing it depends on (utils/trendBuckets)
// is NOT — the two are tested together here because the whole point of this
// component is that both series share one gap-filled axis. trendBuckets.test.js
// covers the bucketing rules themselves.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockChart = { props: null };
vi.mock('react-chartjs-2', () => ({
  Line: (props) => {
    mockChart.props = props;
    return <div data-testid="line" />;
  },
}));

import TrendLineChart from '../../../frontend/src/components/analytics/TrendLineChart';

const DB = [
  { date: '2026-03-01', count: 2 },
  { date: '2026-03-04', count: 1 },
];
const IMPORTED = [{ date: '2026-03-02', count: 5 }];

const chart = () => mockChart.props.data;
const options = () => mockChart.props.options;

beforeEach(() => {
  mockChart.props = null;
});

describe('TrendLineChart — series', () => {
  test('database counts alone render one solid series', () => {
    render(<TrendLineChart data={DB} />);

    expect(chart().datasets).toHaveLength(1);
    expect(chart().datasets[0].label).toBe('Existing (database)');
    expect(chart().datasets[0].fill).toBe(true);
  });

  test('an import adds a second dashed series on the same axis', () => {
    render(<TrendLineChart data={DB} imported={IMPORTED} />);

    const [existing, imported] = chart().datasets;
    expect(imported.label).toBe('Imported (preview)');
    expect(imported.borderDash).toEqual([6, 4]);
    // Same length as the shared axis, so a point cannot land on the wrong day.
    expect(imported.data).toHaveLength(chart().labels.length);
    expect(existing.data).toHaveLength(chart().labels.length);
  });

  test('the "imported only" view drops the database line entirely', () => {
    render(<TrendLineChart data={null} imported={IMPORTED} />);

    expect(chart().datasets).toHaveLength(1);
    expect(chart().datasets[0].label).toBe('Imported (preview)');
  });

  test('silent days between reports are real points, not collapsed away', () => {
    render(<TrendLineChart data={DB} />);

    // 1st and 4th are reported; the 2nd and 3rd must still occupy the axis or
    // a quiet stretch reads as a single step.
    expect(chart().labels).toEqual(['03-01', '03-02', '03-03', '03-04']);
    expect(chart().datasets[0].data).toEqual([2, 0, 0, 1]);
  });

  test('both series are bucketed together, so imported rows land on their own day', () => {
    render(<TrendLineChart data={DB} imported={IMPORTED} />);

    const [existing, imported] = chart().datasets;
    expect(existing.data).toEqual([2, 0, 0, 1]);
    expect(imported.data).toEqual([0, 5, 0, 0]);
  });
});

describe('TrendLineChart — legend', () => {
  test('stays hidden with a single line, which needs no key', () => {
    render(<TrendLineChart data={DB} />);

    expect(options().plugins.legend.display).toBe(false);
  });

  test('appears once there are two lines to tell apart', () => {
    render(<TrendLineChart data={DB} imported={IMPORTED} />);

    expect(options().plugins.legend.display).toBe(true);
  });

  test('legend clicks are disabled so they cannot become a second hidden toggle', () => {
    // Series isolation belongs to the banner's Combined/Existing/Imported
    // switch; a legend that also hid series would fight it.
    render(<TrendLineChart data={DB} imported={IMPORTED} />);

    expect(options().plugins.legend.onClick).toBeNull();
  });
});

describe('TrendLineChart — dense axes', () => {
  test('markers disappear past 60 points, where they hide the line they mark', () => {
    // Reaching 60 points takes monthly buckets: bucketTrend caps a daily axis
    // at ~46 (DAILY_MAX_DAYS) and a weekly one at ~26 (WEEKLY_MAX_DAYS), so
    // only a span of more than five years crosses MARKER_LIMIT.
    const long = Array.from({ length: 70 }, (_, i) => ({
      date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
      count: 1,
    }));

    render(<TrendLineChart data={long} />);

    expect(chart().labels.length).toBeGreaterThan(60);
    expect(chart().datasets[0].pointRadius).toBe(0);
    // Hover still reveals the value, so nothing is lost.
    expect(chart().datasets[0].pointHoverRadius).toBe(5);
  });

  test('a year of history stays well inside the limit and keeps its markers', () => {
    // The realistic case: bucketing lands a year on ~13 monthly-ish points,
    // nowhere near the threshold above.
    const year = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-${String(i + 1).padStart(2, '0')}-01`,
      count: 2,
    }));

    render(<TrendLineChart data={year} />);

    expect(chart().labels.length).toBeLessThan(60);
    expect(chart().datasets[0].pointRadius).toBe(3);
  });

  test('a short range keeps its markers', () => {
    render(<TrendLineChart data={DB} />);

    expect(chart().datasets[0].pointRadius).toBe(3);
  });
});

describe('TrendLineChart — tooltip', () => {
  test('the title names the period, so a bucket is never read as one day', () => {
    render(<TrendLineChart data={DB} />);

    const title = options().plugins.tooltip.callbacks.title;
    expect(title([{ dataIndex: 0 }])).toBeTruthy();
    expect(typeof title([{ dataIndex: 0 }])).toBe('string');
  });

  test('an index past the end of the axis yields an empty title, not a crash', () => {
    render(<TrendLineChart data={DB} />);

    const title = options().plugins.tooltip.callbacks.title;
    expect(title([{ dataIndex: 99 }])).toBe('');
  });
});
