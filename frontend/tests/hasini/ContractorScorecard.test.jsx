// Tests for the UC-005 contractor scorecard (components/analytics/ContractorScorecard.jsx).
//
// Every numeric column on this table is nullable — a contractor with no
// acknowledged job has no average, and avg_reopens stays NULL until migration
// 026 lands reopen_count. What is under test is that each of those holes
// renders as an em dash rather than 'null' or 'NaN', that the figures that do
// exist keep their agreed precision, and that the overdue count only becomes a
// drill-through link when there is something to drill into.
import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import ContractorScorecard from '../../../frontend/src/components/analytics/ContractorScorecard';

const ROWS = [
  {
    contractor: 'Otis Maintenance',
    jobs: 12,
    avg_rectification_days: 4.25,
    repeat_defect_rate: 16.666,
    avg_reopens: 0.125,
    overdue_count: 3,
  },
  {
    contractor: 'Schindler Lifts',
    jobs: 5,
    avg_rectification_days: null,
    repeat_defect_rate: null,
    avg_reopens: null,
    overdue_count: 0,
  },
];

const renderCard = (rows = ROWS) =>
  render(
    <MemoryRouter>
      <ContractorScorecard rows={rows} />
    </MemoryRouter>
  );

const dataRows = () => screen.getAllByRole('row').slice(1);
const cellsOf = (i) => within(dataRows()[i]).getAllByRole('cell').map((td) => td.textContent);

describe('ContractorScorecard — table shape', () => {
  test('names the six columns', () => {
    renderCard();

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Contractor',
      'Jobs',
      'Avg rectification (days)',
      'Repeat-defect rate',
      'Avg re-opens',
      'Overdue',
    ]);
  });

  test('renders one row per contractor, in the order supplied', () => {
    renderCard();

    expect(dataRows()).toHaveLength(2);
    expect(cellsOf(0)[0]).toBe('Otis Maintenance');
    expect(cellsOf(1)[0]).toBe('Schindler Lifts');
  });

  test('no contractors renders the head and no data rows', () => {
    renderCard([]);

    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(dataRows()).toHaveLength(0);
  });
});

describe('ContractorScorecard — figures', () => {
  test('rectification average and repeat rate render to one decimal', () => {
    renderCard();

    const cells = cellsOf(0);
    expect(cells[1]).toBe('12'); // jobs, printed as-is
    expect(cells[2]).toBe('4.3'); // 4.25 rounded
    expect(cells[3]).toBe('16.7%'); // 16.666 rounded, per-cent suffixed
  });

  test('avg re-opens keeps two decimals, since it is usually a fraction of one', () => {
    renderCard();

    // 0.125 -> '0.13'; at one decimal this column would read '0.1' for
    // everything between 0.05 and 0.14 and stop distinguishing contractors.
    expect(cellsOf(0)[4]).toBe('0.13');
  });

  test('a zero average is a real figure and must not render as a dash', () => {
    // 0 is falsy — only an explicit null check keeps this out of the em-dash
    // branch, so a contractor who rectifies same-day still shows 0.0.
    renderCard([{ ...ROWS[0], avg_rectification_days: 0, repeat_defect_rate: 0, avg_reopens: 0 }]);

    const cells = cellsOf(0);
    expect(cells[2]).toBe('0.0');
    expect(cells[3]).toBe('0.0%');
    expect(cells[4]).toBe('0.00');
  });
});

describe('ContractorScorecard — missing data', () => {
  test('each nullable column falls back to an em dash', () => {
    renderCard();

    const cells = cellsOf(1);
    expect(cells[2]).toBe('—'); // no acknowledged job yet
    expect(cells[3]).toBe('—');
    expect(cells[4]).toBe('—'); // reopen_count not migrated yet
  });

  test('a null figure never leaks the word null or a NaN', () => {
    renderCard([ROWS[1]]);

    expect(screen.queryByText(/null|NaN/)).not.toBeInTheDocument();
  });
});

describe('ContractorScorecard — overdue drill-through', () => {
  // The chip's own text is the count, but the Tooltip wrapping it supplies an
  // aria-label, so the link's accessible name is that sentence — which is what
  // a screen-reader user actually hears, and worth asserting as such.
  test('a non-zero count links to the triage queue filtered to that contractor', () => {
    renderCard();

    const link = screen.getByRole('link', {
      name: "View Otis Maintenance's overdue records in the triage queue",
    });
    expect(link).toHaveTextContent('3');
    expect(link).toHaveAttribute(
      'href',
      '/inspections?contractor=Otis%20Maintenance&overdue=true'
    );
  });

  test('a contractor name with URL-unsafe characters is encoded, not broken', () => {
    renderCard([{ ...ROWS[0], contractor: 'Kone & Co / Lifts', overdue_count: 2 }]);

    // The '&' would otherwise start a second query parameter and the '/' would
    // read as a path segment.
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/inspections?contractor=Kone%20%26%20Co%20%2F%20Lifts&overdue=true'
    );
  });

  test('a zero count is shown but is not a link — there is nothing to open', () => {
    renderCard([ROWS[1]]);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
