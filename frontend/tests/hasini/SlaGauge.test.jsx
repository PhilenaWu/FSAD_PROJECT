// Tests for the UC-005 SLA gauge (components/analytics/SlaGauge.jsx).
//
// react-chartjs-2 is mocked out: Chart.js draws to a canvas jsdom does not
// implement, and rendering it would only prove the library works. What is
// under test is what this component builds — the doughnut's two segments and
// the label overlaid on the hole, including the what-if delta.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockChart = { props: null };
vi.mock('react-chartjs-2', () => ({
  Doughnut: (props) => {
    mockChart.props = props;
    return <div data-testid="doughnut" />;
  },
}));

import SlaGauge from '../../../frontend/src/components/analytics/SlaGauge';

const SLA = {
  sla_percentage: 76.4,
  compliant_count: 42,
  total_resolved: 55,
  sla_threshold_hrs: 72,
};

beforeEach(() => {
  mockChart.props = null;
});

describe('SlaGauge', () => {
  test('splits the doughnut into compliant and breached shares', () => {
    render(<SlaGauge sla={SLA} />);

    const [within, breached] = mockChart.props.data.datasets[0].data;

    expect(within).toBe(76.4);
    // Float subtraction gives 23.599999999999994, which Chart.js draws
    // identically — what has to hold is that the two segments close the ring.
    expect(breached).toBeCloseTo(23.6, 10);
    expect(within + breached).toBeCloseTo(100, 10);
    expect(mockChart.props.data.labels).toEqual(['Within SLA', 'Breached']);
  });

  test('the centre reads the whole percentage and the counts behind it', () => {
    render(<SlaGauge sla={SLA} />);

    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText('42/55 within 72h')).toBeInTheDocument();
  });

  test('the legend stays off so it cannot squeeze the centre label out of line', () => {
    render(<SlaGauge sla={SLA} />);

    expect(mockChart.props.options.plugins.legend.display).toBe(false);
  });

  test('the tooltip states each segment to one decimal', () => {
    render(<SlaGauge sla={SLA} />);

    const label = mockChart.props.options.plugins.tooltip.callbacks.label;
    expect(label({ label: 'Within SLA', raw: 76.4 })).toBe('Within SLA: 76.4%');
  });
});

describe('SlaGauge — what-if preview', () => {
  test('a baseline that moved shows the before figure and the arrow to the new one', () => {
    render(<SlaGauge sla={SLA} baseline={{ ...SLA, sla_percentage: 78.9 }} />);

    expect(screen.getByText('78.9%')).toBeInTheDocument();
    expect(screen.getByText('→ 76.4%')).toBeInTheDocument();
    expect(screen.getByText('with imported rows')).toBeInTheDocument();
  });

  test('a baseline identical to the current figure is not a change worth showing', () => {
    // Importing rows that do not move the number must not dress the gauge up
    // as though something happened.
    render(<SlaGauge sla={SLA} baseline={{ ...SLA }} />);

    expect(screen.queryByText('with imported rows')).not.toBeInTheDocument();
    expect(screen.getByText('76%')).toBeInTheDocument();
  });

  test('with no baseline at all the gauge renders its normal face', () => {
    render(<SlaGauge sla={SLA} />);

    expect(screen.queryByText(/with imported rows/)).not.toBeInTheDocument();
    expect(screen.getByText('42/55 within 72h')).toBeInTheDocument();
  });
});
