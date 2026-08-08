// Tests for the UC-011 spend-by-category bars (components/cost/CategoryBarChart.jsx).
//
// react-chartjs-2 is mocked — what is under test is the series this component
// builds, the drill-down it wires to a bar click, and the money formatting in
// the tooltip and on the axis.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockChart = { props: null };
vi.mock('react-chartjs-2', () => ({
  Bar: (props) => {
    mockChart.props = props;
    return <div data-testid="bar" />;
  },
}));

import CategoryBarChart from '../../../frontend/src/components/cost/CategoryBarChart';

const DATA = [
  { category: 'Doors', actual_cost: 18240.5, jobs: 7 },
  { category: 'Lighting', actual_cost: 3120, jobs: 1 },
];

const chart = () => mockChart.props.data;
const options = () => mockChart.props.options;

beforeEach(() => {
  vi.clearAllMocks();
  mockChart.props = null;
});

describe('CategoryBarChart — series', () => {
  test('one bar per category, in the order the server ranked them', () => {
    render(<CategoryBarChart data={DATA} />);

    // The server returns cost-heaviest first; re-sorting here would fight it.
    expect(chart().labels).toEqual(['Doors', 'Lighting']);
    expect(chart().datasets[0].data).toEqual([18240.5, 3120]);
  });

  test('no categories renders an empty chart rather than throwing', () => {
    render(<CategoryBarChart data={[]} />);

    expect(chart().labels).toEqual([]);
    expect(chart().datasets[0].data).toEqual([]);
  });
});

describe('CategoryBarChart — drill-down', () => {
  test('clicking a bar reports the category it belongs to', () => {
    const onBarClick = vi.fn();
    render(<CategoryBarChart data={DATA} onBarClick={onBarClick} />);

    options().onClick(null, [{ index: 1 }]);

    expect(onBarClick).toHaveBeenCalledWith('Lighting');
  });

  test('a click on empty space reports nothing', () => {
    const onBarClick = vi.fn();
    render(<CategoryBarChart data={DATA} onBarClick={onBarClick} />);

    options().onClick(null, []);

    expect(onBarClick).not.toHaveBeenCalled();
  });

  test('a chart rendered without a handler survives a click', () => {
    // The panel is reused read-only in the export preview, where there is
    // nothing to drill into.
    render(<CategoryBarChart data={DATA} />);

    expect(() => options().onClick(null, [{ index: 0 }])).not.toThrow();
  });
});

describe('CategoryBarChart — formatting', () => {
  test('the tooltip gives the money and the job count behind it', () => {
    render(<CategoryBarChart data={DATA} />);

    const label = options().plugins.tooltip.callbacks.label;
    expect(label({ raw: 18240.5, dataIndex: 0 })).toBe('$18,240.50 across 7 jobs');
  });

  test('a single job reads singular', () => {
    render(<CategoryBarChart data={DATA} />);

    const label = options().plugins.tooltip.callbacks.label;
    expect(label({ raw: 3120, dataIndex: 1 })).toBe('$3,120.00 across 1 job');
  });

  test('the axis ticks are dollar amounts with thousands separators', () => {
    render(<CategoryBarChart data={DATA} />);

    const tick = options().scales.y.ticks.callback;
    expect(tick(20000)).toBe('$20,000');
    expect(options().scales.y.beginAtZero).toBe(true);
  });
});
