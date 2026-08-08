// Tests for the UC-005 priority queue table (components/analytics/PriorityQueue.jsx).
//
// The composite score (ai_priority_score × 0.5 + recency × 0.3 + frequency × 0.2)
// is computed server-side, so the ranking itself is not this component's job —
// what is under test is that the table renders the server's order faithfully
// rather than quietly re-sorting it, and that each row's link, chip and score
// come out the way the manager reads them.
import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import PriorityQueue from '../../../frontend/src/components/analytics/PriorityQueue';

// Deliberately NOT in score order: the server ranks, the table renders. If the
// component ever sorts on its own, the first-row assertion below breaks.
const ROWS = [
  {
    id: 'insp-1',
    title: 'Lift cabin door fault',
    block: '44A',
    category: 'Lift',
    priority: 'Critical',
    status: 'Open',
    composite_score: 8.25,
  },
  {
    id: 'insp-2',
    title: 'Corridor light out',
    block: '12B',
    category: 'Electrical',
    priority: 'Low',
    status: 'Assigned',
    composite_score: 9.44,
  },
  {
    id: 'insp-3',
    title: 'Ceiling seepage',
    block: '7C',
    category: 'Plumbing',
    priority: 'Medium',
    status: 'Rectified',
    composite_score: 3.0,
  },
];

const renderQueue = (rows = ROWS) =>
  render(
    <MemoryRouter>
      <PriorityQueue rows={rows} />
    </MemoryRouter>
  );

// The header row is a row too — data rows start at index 1.
const dataRows = () => screen.getAllByRole('row').slice(1);

describe('PriorityQueue — table shape', () => {
  test('names the six columns the manager triages on', () => {
    renderQueue();

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Record', 'Block', 'Category', 'Priority', 'Status', 'Score']);
  });

  test('renders one row per record', () => {
    renderQueue();

    expect(dataRows()).toHaveLength(3);
  });

  test('an empty queue renders the head and no data rows, not a crash', () => {
    renderQueue([]);

    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(dataRows()).toHaveLength(0);
  });
});

describe('PriorityQueue — ordering', () => {
  test('keeps the server ranking instead of re-sorting by score', () => {
    // insp-2 scores highest (9.44) but arrives second; a client-side sort would
    // float it to the top and silently disagree with the API's ranking.
    renderQueue();

    const titles = dataRows().map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(titles).toEqual(['Lift cabin door fault', 'Corridor light out', 'Ceiling seepage']);
  });

  test('does not re-order by priority either', () => {
    // 'Low' sits between 'Critical' and 'Medium' here — untouched.
    renderQueue();

    const priorities = dataRows().map((row) => within(row).getAllByRole('cell')[3].textContent);
    expect(priorities).toEqual(['Critical', 'Low', 'Medium']);
  });
});

describe('PriorityQueue — cells', () => {
  test('each title links to the record detail page under /inspections', () => {
    // /inspections, not /incidents — the latter hits the catch-all and bounces.
    renderQueue();

    expect(screen.getByRole('link', { name: 'Lift cabin door fault' })).toHaveAttribute(
      'href',
      '/inspections/insp-1'
    );
    expect(screen.getByRole('link', { name: 'Ceiling seepage' })).toHaveAttribute(
      'href',
      '/inspections/insp-3'
    );
  });

  test('block, category and status are printed as given', () => {
    renderQueue();

    const cells = within(dataRows()[0]).getAllByRole('cell').map((td) => td.textContent);
    expect(cells[1]).toBe('44A');
    expect(cells[2]).toBe('Lift');
    expect(cells[4]).toBe('Open');
  });

  test('scores render to exactly one decimal, including whole numbers', () => {
    renderQueue();

    const scores = dataRows().map((row) => within(row).getAllByRole('cell')[5].textContent);
    // 3.0 must not collapse to '3' — the column has to stay decimal-aligned.
    expect(scores).toEqual(['8.3', '9.4', '3.0']);
  });

  test('a score is rounded, not truncated', () => {
    renderQueue([{ ...ROWS[0], composite_score: 7.86 }]);

    expect(screen.getByText('7.9')).toBeInTheDocument();
  });
});

describe('PriorityQueue — priority chip', () => {
  test('a known priority carries its heat-ramp colours', () => {
    renderQueue([ROWS[0]]);

    // MUI's sx compiles to a class, so the colours are only visible through
    // the computed style — el.style is empty here.
    const chip = screen.getByText('Critical');
    const style = window.getComputedStyle(chip.closest('.MuiChip-root'));

    expect(style.backgroundColor).toBe('rgb(153, 27, 27)'); // #991B1B, dark red
    expect(style.color).toBe('rgb(255, 255, 255)');
  });

  test('the ramp gets hotter from Low to Critical', () => {
    renderQueue([
      { ...ROWS[0], id: 'a', priority: 'Low' },
      { ...ROWS[0], id: 'b', priority: 'Medium' },
      { ...ROWS[0], id: 'c', priority: 'High' },
    ]);

    const bg = (label) =>
      window.getComputedStyle(screen.getByText(label).closest('.MuiChip-root')).backgroundColor;

    expect(bg('Low')).toBe('rgb(250, 204, 21)'); // #FACC15 yellow
    expect(bg('Medium')).toBe('rgb(251, 146, 60)'); // #FB923C orange
    expect(bg('High')).toBe('rgb(239, 68, 68)'); // #EF4444 red
  });

  test('an unmapped priority still shows its own label rather than blanking', () => {
    // priorityDisplay falls through unmapped values so a new DB enum value
    // degrades to a plain chip instead of breaking the queue.
    renderQueue([{ ...ROWS[0], priority: 'Urgent' }]);

    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });
});
