// The shared canvas e-signature pad (UC-004 close, UC-010 contractor sign-off).
//
// What is under test is its imperative contract, because that is what every
// caller depends on: isEmpty() gates submission (the close flow refuses an
// unsigned record), toBlob() produces the PNG that gets uploaded, and clear()
// has to put the pad back to genuinely empty rather than merely blank-looking.
// A pad that reported ink it did not have, or lost ink it did, would let an
// unsigned close through or block a signed one.
//
// jsdom has no canvas implementation, so the 2D context is stubbed and the
// assertions are about the pad's own state machine and what it asks the canvas
// to do — not about pixels.
import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import SignaturePad from '../../src/components/SignaturePad';

// One shared spy set so a test can assert the pad actually drew.
let ctx;

beforeEach(() => {
  ctx = {
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  // The pad captures the pointer so a stroke that leaves the canvas still
  // draws; jsdom does not implement it.
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb(new Blob(['png'], { type: 'image/png' })));
});

function renderPad(label = 'Checked by — Nurul') {
  const ref = createRef();
  render(<SignaturePad ref={ref} label={label} />);
  return { ref, canvas: document.querySelector('canvas') };
}

// A stroke: press, drag, release. clientX/Y are read against the canvas rect,
// which jsdom reports as all-zero — fine, the coordinates are not the point.
function sign(canvas) {
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

describe('SignaturePad', () => {
  test('starts empty, and says so through the ref', () => {
    const { ref } = renderPad();
    expect(ref.current.isEmpty()).toBe(true);
  });

  test('a stroke counts as ink', () => {
    const { ref, canvas } = renderPad();

    sign(canvas);

    expect(ref.current.isEmpty()).toBe(false);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  // The pad deliberately draws a hairline on pointerdown so a signature made of
  // taps (a dot, a full stop) is still a signature. Without it, a tap left the
  // pad reporting empty and the close was refused for a pad the user had
  // visibly marked.
  test('a tap with no movement still counts', () => {
    const { ref, canvas } = renderPad();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(ref.current.isEmpty()).toBe(false);
  });

  test('moving without pressing draws nothing', () => {
    const { ref, canvas } = renderPad();

    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });

    expect(ref.current.isEmpty()).toBe(true);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  // Releasing ends the stroke: a later move must not continue the old line, or
  // dragging across the pad after signing would keep extending the signature.
  test('a move after release does not keep drawing', () => {
    const { canvas } = renderPad();

    sign(canvas);
    const strokesAfterSigning = ctx.stroke.mock.calls.length;
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: 90 });

    expect(ctx.stroke.mock.calls.length).toBe(strokesAfterSigning);
  });

  test('Clear is disabled until there is something to clear', () => {
    const { canvas } = renderPad();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();

    sign(canvas);

    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  test('Clear returns the pad to empty, by the ref and by the button', () => {
    const { ref, canvas } = renderPad();
    sign(canvas);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(ref.current.isEmpty()).toBe(true);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    // Repainted rather than left as-is — a cleared pad must export blank.
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  // resetForm() on the inspection and close flows calls clear() straight off
  // the ref. act() is needed because that path is outside React's own event
  // handling: isEmpty() reads the `hasInk` captured at the last render, so
  // without flushing the state update the ref would still answer with the
  // pre-clear value.
  test('clear() through the ref works too — the close flow calls it on reset', () => {
    const { ref, canvas } = renderPad();
    sign(canvas);

    act(() => ref.current.clear());

    expect(ref.current.isEmpty()).toBe(true);
  });

  test('can be signed again after clearing', () => {
    const { ref, canvas } = renderPad();
    sign(canvas);
    act(() => ref.current.clear());

    sign(canvas);

    expect(ref.current.isEmpty()).toBe(false);
  });

  test('toBlob resolves a PNG for upload', async () => {
    const { ref, canvas } = renderPad();
    sign(canvas);

    const blob = await ref.current.toBlob();

    expect(blob).toBeInstanceOf(Blob);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png'
    );
  });

  test('renders the label it is given — the pads are told apart by it', () => {
    renderPad('Endorser signature — Nurul Aisyah');
    expect(screen.getByText('Endorser signature — Nurul Aisyah')).toBeInTheDocument();
  });
});
