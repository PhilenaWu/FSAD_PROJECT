// Tests for the UC-005 heatmap (components/analytics/HeatmapChart.jsx).
//
// react-chartjs-2 is mocked — Chart.js draws to a canvas jsdom does not
// implement, and the matrix plugin's rendering is the library's business. What
// is under test is what this component hands it: the cell points, the two
// category axes, the drill-down click, and the tooltip wording.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockChart = { props: null };
vi.mock('react-chartjs-2', () => ({
  Chart: (props) => {
    mockChart.props = props;
    return <div data-testid="matrix" />;
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

import HeatmapChart from '../../../frontend/src/components/analytics/HeatmapChart';

const DATA = [
  { block: '44A', category: 'Doors', count: 8 },
  { block: '44A', category: 'Lighting', count: 1 },
  { block: '44B', category: 'Doors', count: 3 },
];

const dataset = () => mockChart.props.data.datasets[0];
const options = () => mockChart.props.options;

beforeEach(() => {
  vi.clearAllMocks();
  mockChart.props = null;
});

describe('HeatmapChart — the grid it builds', () => {
  test('each row becomes one cell keyed by block, category and count', () => {
    render(<HeatmapChart data={DATA} />);

    expect(dataset().data).toEqual([
      { x: '44A', y: 'Doors', v: 8, imp: 0 },
      { x: '44A', y: 'Lighting', v: 1, imp: 0 },
      { x: '44B', y: 'Doors', v: 3, imp: 0 },
    ]);
  });

  test('the axes list each block and category once, in the order they appear', () => {
    render(<HeatmapChart data={DATA} />);

    // 44A appears twice in the data but must occupy one column.
    expect(options().scales.x.labels).toEqual(['44A', '44B']);
    expect(options().scales.y.labels).toEqual(['Doors', 'Lighting']);
  });

  test('an empty result set renders a chart rather than throwing', () => {
    // maxCount floors at 1, so the colour scale cannot divide by zero.
    render(<HeatmapChart data={[]} />);

    expect(dataset().data).toEqual([]);
    expect(options().scales.x.labels).toEqual([]);
  });
});

describe('HeatmapChart — drill-down', () => {
  test('clicking a cell opens the inspection list filtered to it', () => {
    render(<HeatmapChart data={DATA} />);

    options().onClick(null, [{ index: 2 }]);

    // /inspections, not /incidents — the latter is not a route, and every
    // drill-through used to hit the catch-all and bounce straight back.
    expect(mockNavigate).toHaveBeenCalledWith('/inspections?block=44B&category=Doors');
  });

  test('block and category are URL-encoded, so a value with a space survives', () => {
    render(<HeatmapChart data={[{ block: '44 A&B', category: 'Doors & Gates', count: 2 }]} />);

    options().onClick(null, [{ index: 0 }]);

    expect(mockNavigate).toHaveBeenCalledWith(
      '/inspections?block=44%20A%26B&category=Doors%20%26%20Gates'
    );
  });

  test('a click that lands on no cell navigates nowhere', () => {
    render(<HeatmapChart data={DATA} />);

    options().onClick(null, []);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('HeatmapChart — tooltip wording', () => {
  const label = () => options().plugins.tooltip.callbacks.label;

  test('one issue reads singular, several read plural', () => {
    render(<HeatmapChart data={DATA} />);

    expect(label()({ raw: { v: 1, imp: 0 } })).toBe('1 issue');
    expect(label()({ raw: { v: 8, imp: 0 } })).toBe('8 issues');
  });

  test('the title names the block and category of the cell', () => {
    render(<HeatmapChart data={DATA} />);

    const title = options().plugins.tooltip.callbacks.title;
    expect(title([{ raw: { x: '44A', y: 'Doors' } }])).toBe('Block 44A — Doors');
  });
});

describe('HeatmapChart — what-if preview', () => {
  const IMPORTED = { '44A|Doors': 3 };

  test('a cell carrying imported rows is marked and broken down in the tooltip', () => {
    render(<HeatmapChart data={DATA} importedMap={IMPORTED} />);

    expect(dataset().data[0]).toEqual({ x: '44A', y: 'Doors', v: 8, imp: 3 });

    const label = options().plugins.tooltip.callbacks.label;
    expect(label({ raw: { v: 8, imp: 3 } })).toBe('8 issues (5 existing + 3 imported)');
  });

  test('the amber ring is drawn only around cells the import touched', () => {
    render(<HeatmapChart data={DATA} importedMap={IMPORTED} />);

    const border = dataset().borderWidth;
    expect(border({ raw: { imp: 3 } })).toBe(3);
    expect(border({ raw: { imp: 0 } })).toBe(2);
  });

  test('cells the import did not touch keep an imported count of zero', () => {
    render(<HeatmapChart data={DATA} importedMap={IMPORTED} />);

    expect(dataset().data[1].imp).toBe(0);
    expect(dataset().data[2].imp).toBe(0);
  });
});
