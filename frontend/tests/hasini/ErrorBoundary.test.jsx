// ErrorBoundary — the app's last line of defence against a render-time throw.
// Before it existed, any such throw unmounted the whole tree and left a blank
// white page, so what matters here is that something readable survives.
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ErrorBoundary from '../../../frontend/src/components/ErrorBoundary';

function Boom() {
  throw new Error('heatmap blew up');
}

// React logs the caught error itself; silence it so the run stays readable.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  test('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>dashboard content</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('dashboard content')).toBeInTheDocument();
  });

  test('a throwing child yields a message and a reload, not a blank page', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong on this page')).toBeInTheDocument();
    // The specific cause is surfaced — that is what a white screen withheld.
    expect(screen.getByText('heatmap blew up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
