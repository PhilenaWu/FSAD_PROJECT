// Tests for the UC-011 monthly spend trend and its projection
// (components/cost/CostTrendChart.jsx).
//
// react-chartjs-2 is mocked. The logic worth testing is how the projected
// series is stitched onto the actual one: the dashed curve has to start exactly
// where the solid line ends, and the uncertainty band has to be drawn without
// leaking into the legend or the tooltip.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockChart = { props: null };
vi.mock('react-chartjs-2', () => ({
  Line: (props) => {
    mockChart.props = props;
    return <div data-testid="line" />;
  },
}));

import CostTrendChart from '../../components/cost/CostTrendChart';

const DATA = [
  { month: '2026-01', actual_cost: 4000, jobs: 3 },
  { month: '2026-02', actual_cost: 5200, jobs: 4 },
  { month: '2026-03', actual_cost: 6100, jobs: 1 },
];

const FORECAST = {
  points: [
    { month: '2026-04', value: 6500, lower: 5200, upper: 7800 },
    { month: '2026-05', value: 6800, lower: 5000, upper: 8600 },
  ],
};

const chart = () => mockChart.props.data;
const options = () => mockChart.props.options;
const byLabel = (label) => chart().datasets.find((d) => d.label === label);

beforeEach(() => {
  mockChart.props = null;
});

describe('CostTrendChart — actuals only', () => {
  test('plots one point per month with nothing else drawn', () => {
    render(<CostTrendChart data={DATA} forecast={null} />);

    expect(chart().labels).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(chart().datasets).toHaveLength(1);
    expect(chart().datasets[0].data).toEqual([4000, 5200, 6100]);
  });

  test('the legend stays hidden when there is only one series to name', () => {
    render(<CostTrendChart data={DATA} forecast={null} />);

    expect(options().plugins.legend.display).toBe(false);
  });

  test('a forecast with no points is treated as no forecast', () => {
    render(<CostTrendChart data={DATA} forecast={{ points: [] }} />);

    expect(chart().datasets).toHaveLength(1);
  });

  test('no data at all renders an empty chart rather than throwing', () => {
    // lastActual falls back to null instead of reading off the end of the array.
    render(<CostTrendChart data={[]} forecast={null} />);

    expect(chart().labels).toEqual([]);
    expect(chart().datasets[0].data).toEqual([]);
  });
});

describe('CostTrendChart — projection', () => {
  test('the axis is extended by the projected months', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    expect(chart().labels).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  });

  test('the solid line stops at the last actual month', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    // Nulls over the projected months, or the actual line would run on into
    // figures nobody has spent yet.
    expect(byLabel('Actual spend').data).toEqual([4000, 5200, 6100, null, null]);
  });

  test('the dashed curve is anchored on the last actual, so the line continues', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    // A leading null at the join would leave a visible gap between the two.
    expect(byLabel('Projected (damped trend)').data).toEqual([null, null, 6100, 6500, 6800]);
  });

  test('the uncertainty band is drawn as two edges filled against each other', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    expect(byLabel('_band_lower').data).toEqual([null, null, 6100, 5200, 5000]);
    expect(byLabel('_band_upper').data).toEqual([null, null, 6100, 7800, 8600]);
    // '-1' fills down to the dataset before it — the lower edge.
    expect(byLabel('_band_upper').fill).toBe('-1');
    expect(byLabel('_band_lower').fill).toBe(false);
  });

  test('the band edges are hidden from the legend and the tooltip', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    const legendFilter = options().plugins.legend.labels.filter;
    const tooltipFilter = options().plugins.tooltip.filter;

    expect(legendFilter({ text: '_band_upper' })).toBe(false);
    expect(legendFilter({ text: 'Actual spend' })).toBe(true);
    expect(tooltipFilter({ dataset: { label: '_band_lower' } })).toBe(false);
    expect(tooltipFilter({ dataset: { label: 'Projected (damped trend)' } })).toBe(true);
  });
});

describe('CostTrendChart — tooltip', () => {
  test('an actual month gives the spend and the jobs behind it', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    const label = options().plugins.tooltip.callbacks.label;
    expect(label({ dataset: { label: 'Actual spend' }, dataIndex: 1, raw: 5200 })).toBe(
      '$5,200.00 across 4 jobs'
    );
  });

  test('a month with one job reads singular', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    const label = options().plugins.tooltip.callbacks.label;
    expect(label({ dataset: { label: 'Actual spend' }, dataIndex: 2, raw: 6100 })).toBe(
      '$6,100.00 across 1 job'
    );
  });

  test('a projected month gives the figure and its likely range', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    const label = options().plugins.tooltip.callbacks.label;
    expect(
      label({ dataset: { label: 'Projected (damped trend)' }, dataIndex: 3, raw: 6500 })
    ).toBe('$6,500.00 projected (likely $5,200.00–$7,800.00)');
  });

  test('the projection point sitting on the join reads as an actual, not a forecast', () => {
    render(<CostTrendChart data={DATA} forecast={FORECAST} />);

    // dataIndex 2 is the anchor: it repeats the last actual month, so it must
    // not be described with a projection range.
    const label = options().plugins.tooltip.callbacks.label;
    expect(
      label({ dataset: { label: 'Projected (damped trend)' }, dataIndex: 2, raw: 6100 })
    ).toBe('$6,100.00 across 1 job');
  });
});
