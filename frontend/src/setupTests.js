// Vitest setup for component tests: jest-dom matchers, automatic unmount
// between tests, and stubs for the browser APIs jsdom does not implement but
// MUI and the dashboards call.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// MUI's responsive helpers and Chart.js both read matchMedia.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Chart.js measures its canvas on mount. Chart components are mocked in the
// page tests, but this keeps any incidental canvas use from throwing.
if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = () => null;
}

// jsdom implements neither, and the CSV export path touches both.
if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock');
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
