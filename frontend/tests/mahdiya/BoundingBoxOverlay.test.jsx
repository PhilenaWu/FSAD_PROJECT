// BoundingBoxOverlay (UC-007) draws a Roboflow box on top of a photo. The box
// coords are in the *original* image's pixel space, which can differ from the
// rendered <img> size — the component measures the real vs. natural size on
// load and scales the box to match. That scaling math is what's under test.
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import BoundingBoxOverlay from '../../src/components/cv/BoundingBoxOverlay';

// jsdom never actually loads images, so naturalWidth/Height default to 0 —
// stub them before firing 'load' to simulate a real image at a known size.
function fireLoadWithNaturalSize(img, naturalWidth, naturalHeight, clientWidth, clientHeight) {
  Object.defineProperty(img, 'naturalWidth', { value: naturalWidth, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: naturalHeight, configurable: true });
  Object.defineProperty(img, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(img, 'clientHeight', { value: clientHeight, configurable: true });
  fireEvent.load(img);
}

describe('BoundingBoxOverlay', () => {
  test('renders the image and no box before the image has loaded', () => {
    render(
      <BoundingBoxOverlay
        imageUrl="https://example.com/defect.jpg"
        boundingBox={{ x: 100, y: 100, width: 40, height: 40 }}
        alt="Defect photo"
      />
    );

    expect(screen.getByAltText('Defect photo')).toBeInTheDocument();
    // No box yet — scale is only known once onLoad fires.
    expect(screen.queryByText('crack')).not.toBeInTheDocument();
  });

  test('renders no box at all when boundingBox is not provided', () => {
    const { container } = render(
      <BoundingBoxOverlay imageUrl="https://example.com/defect.jpg" boundingBox={null} />
    );
    fireLoadWithNaturalSize(container.querySelector('img'), 800, 600, 400, 300);

    // Only the <img> box — no absolutely-positioned overlay sibling.
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.firstChild.children).toHaveLength(1);
  });

  test('scales the box to match the rendered image size vs. its natural size', () => {
    // Original image is 800x600 (Roboflow's coordinate space); rendered at
    // half that, 400x300 — so every coordinate should be halved.
    const { container } = render(
      <BoundingBoxOverlay
        imageUrl="https://example.com/defect.jpg"
        boundingBox={{ x: 200, y: 150, width: 100, height: 80 }} // centre x/y, not top-left
        label="crack"
      />
    );
    fireLoadWithNaturalSize(container.querySelector('img'), 800, 600, 400, 300);

    expect(screen.getByText('crack')).toBeInTheDocument();

    // left = (x - width/2) * scale.x = (200 - 50) * 0.5 = 75
    // top  = (y - height/2) * scale.y = (150 - 40) * 0.5 = 55
    // width = 100 * 0.5 = 50, height = 80 * 0.5 = 40
    // MUI's sx prop compiles to a generated CSS class, not an inline style
    // attribute, so the applied values have to be read via computed style.
    const boxes = container.querySelectorAll('div');
    const box = Array.from(boxes).find((el) => {
      const style = window.getComputedStyle(el);
      return style.width === '50px' && style.height === '40px';
    });
    expect(box).toBeTruthy();
    expect(window.getComputedStyle(box).left).toBe('75px');
    expect(window.getComputedStyle(box).top).toBe('55px');
  });

  test('does not render a label chip when no label is given, even with a box', () => {
    const { container } = render(
      <BoundingBoxOverlay
        imageUrl="https://example.com/defect.jpg"
        boundingBox={{ x: 200, y: 150, width: 100, height: 80 }}
      />
    );
    fireLoadWithNaturalSize(container.querySelector('img'), 800, 600, 400, 300);

    expect(container.querySelector('.MuiChip-root')).not.toBeInTheDocument();
  });
});
