// Tests for the UC-011 panel wrapper (components/cost/CostPanel.jsx).
//
// Every section of the cost dashboard is wrapped in one of these, so the
// wrapper is what guarantees each panel states the window its numbers cover.
// Two of its details are load-bearing and easy to regress: the title renders as
// a div (a Chip inside an <h6> is invalid HTML and React warns), and the
// caption keeps a minimum height so panels with no subtitle still line their
// chart tops up with the panels beside them.
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Chip } from '@mui/material';

import CostPanel from '../../../frontend/src/components/cost/CostPanel';

describe('CostPanel — content', () => {
  test('renders the title, the period subtitle and the panel body', () => {
    render(
      <CostPanel title="Spend by category" subtitle="Jan – Jun 2026">
        <div data-testid="chart" />
      </CostPanel>
    );

    expect(screen.getByText('Spend by category')).toBeInTheDocument();
    expect(screen.getByText('Jan – Jun 2026')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  test('the children are the panel body, not a sibling of it', () => {
    const { container } = render(
      <CostPanel title="Spend" subtitle="2026">
        <div data-testid="chart" />
      </CostPanel>
    );

    // Everything lives inside the outlined Paper — nothing escapes the card.
    const paper = container.querySelector('.MuiPaper-outlined');
    expect(paper).toContainElement(screen.getByTestId('chart'));
  });

  test('renders as an outlined Paper, matching the other dashboard cards', () => {
    const { container } = render(<CostPanel title="Spend" subtitle="2026" />);

    expect(container.querySelector('.MuiPaper-outlined')).toBeInTheDocument();
  });

  test('a panel with no children still renders its heading', () => {
    render(<CostPanel title="Spend" subtitle="2026" />);

    expect(screen.getByText('Spend')).toBeInTheDocument();
  });
});

describe('CostPanel — the action slot', () => {
  test('renders an action when one is given', () => {
    render(
      <CostPanel
        title="Jobs"
        subtitle="2026"
        action={<button type="button">Export</button>}
      />
    );

    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  test('no action means no empty action box left behind', () => {
    render(<CostPanel title="Jobs" subtitle="2026" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('the action is hidden from print, since toggles mean nothing on paper', () => {
    render(
      <CostPanel title="Jobs" subtitle="2026" action={<button type="button">Export</button>} />
    );

    // sx compiles to a class, so displayPrint is only visible via the computed
    // style — the element's inline style attribute is empty.
    const slot = screen.getByRole('button', { name: 'Export' }).parentElement;
    expect(slot.style.display).toBe('');
    expect(window.getComputedStyle(slot, null).display).toBe('block');
  });
});

describe('CostPanel — layout guarantees', () => {
  test('the title renders as a div so a Chip inside it stays valid HTML', () => {
    // Panel titles carry status chips ("3 lifts watched"); a div inside an
    // <h6> would be invalid and React would warn about the nesting.
    render(
      <CostPanel
        title={<>Lift watchlist <Chip label="3" size="small" /></>}
        subtitle="2026"
      />
    );

    const title = screen.getByText(/Lift watchlist/);
    expect(title.tagName).toBe('DIV');
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('the caption holds its height so panels without a subtitle still align', () => {
    render(<CostPanel title="Spend" />);

    // minHeight 18 keeps the chart top level with the panel beside it.
    const caption = document.querySelector('.MuiTypography-caption');
    expect(window.getComputedStyle(caption).minHeight).toBe('18px');
  });

  test('the subtitle is a div too, so the caption never nests a block in a <p>', () => {
    render(<CostPanel title="Spend" subtitle="Jan – Jun 2026" />);

    expect(screen.getByText('Jan – Jun 2026').tagName).toBe('DIV');
  });
});
