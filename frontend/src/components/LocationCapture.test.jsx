// What is under test is the suggestion the card makes from a fix, not the
// geolocation call: a captured fix names the nearest block, and when that
// disagrees with the block the user picked, the card says plainly that their
// choice is the one submitted.
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import LocationCapture from './LocationCapture';

// Coordinates of block 44A in utils/blocks.js.
const FIX_AT_44A = {
  lat: 1.3521,
  lng: 103.8198,
  accuracy_m: 12.4,
  captured_at: '2026-08-07T02:00:00.000Z',
};

describe('LocationCapture', () => {
  test('with no fix it offers to capture and suggests nothing', () => {
    render(<LocationCapture value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Capture location' })).toBeInTheDocument();
    expect(screen.queryByText(/Suggested location/)).not.toBeInTheDocument();
  });

  test('a fix names the nearest block instead of a bare accuracy reading', () => {
    render(<LocationCapture value={FIX_AT_44A} onChange={vi.fn()} />);
    expect(screen.getByText(/Suggested location: Block 44A/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recapture location' })).toBeInTheDocument();
  });

  test('a fix agreeing with the selection says nothing further', () => {
    render(<LocationCapture value={FIX_AT_44A} onChange={vi.fn()} selectedBlock="44A" />);
    expect(screen.getByText(/Suggested location: Block 44A/)).toBeInTheDocument();
    expect(screen.queryByText(/gets submitted/i)).not.toBeInTheDocument();
  });

  test('a selection that differs from the fix wins, and the card says so', () => {
    render(<LocationCapture value={FIX_AT_44A} onChange={vi.fn()} selectedBlock="45B" />);
    expect(screen.getByText(/You chose Block 45B — that is what gets submitted\./)).toBeInTheDocument();
    // The suggestion is still shown; it just does not override the choice.
    expect(screen.getByText(/Suggested location: Block 44A/)).toBeInTheDocument();
  });
});
