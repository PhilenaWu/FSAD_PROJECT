// Tests for the UC-005 AI risk alert card (components/analytics/AIAlertCard.jsx).
//
// The card is the manager's decision point on a predicted defect cluster:
// accepting it opens a preventive-maintenance record, dismissing it closes the
// alert. What is under test is that the alert reads correctly, that both
// actions report the right prediction id back, and that `busy` actually locks
// the pair so a slow request cannot be double-submitted.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AIAlertCard from '../../../frontend/src/components/analytics/AIAlertCard';

const ALERT = {
  id: 'pred-1',
  location_block: '44A',
  category: 'Lift',
  velocity_pct: 150.4,
  estimated_cost: 12500,
  alert_text: 'Lift faults in Block 44A are accelerating; schedule a service visit.',
};

let onAccept;
let onDismiss;

beforeEach(() => {
  onAccept = vi.fn();
  onDismiss = vi.fn();
});

const renderCard = (alert = ALERT, props = {}) =>
  render(<AIAlertCard alert={alert} onAccept={onAccept} onDismiss={onDismiss} {...props} />);

describe('AIAlertCard — content', () => {
  test('heads the card with the block and category the cluster sits in', () => {
    renderCard();

    expect(screen.getByText('Block 44A — Lift')).toBeInTheDocument();
  });

  test('shows the alert text the model produced', () => {
    renderCard();

    expect(screen.getByText(ALERT.alert_text)).toBeInTheDocument();
  });

  test('the velocity chip is a whole per cent over the 30-day window', () => {
    renderCard();

    // 150.4 -> '150'; a decimal here reads as false precision on a projection.
    expect(screen.getByText('▲ 150% in 30 days')).toBeInTheDocument();
  });

  test('the cost chip is thousands-separated', () => {
    renderCard();

    expect(screen.getByText(`Est. $${(12500).toLocaleString()}`)).toBeInTheDocument();
  });

  test('renders as a warning alert, so it reads as amber next to the other panels', () => {
    renderCard();

    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-colorWarning');
  });
});

describe('AIAlertCard — the cost chip is optional', () => {
  test('a null cost drops the chip rather than printing "Est. $null"', () => {
    // estimated_cost is null whenever the model had no comparable job history.
    renderCard({ ...ALERT, estimated_cost: null });

    expect(screen.queryByText(/Est\. \$/)).not.toBeInTheDocument();
    // The rest of the card still stands.
    expect(screen.getByText('▲ 150% in 30 days')).toBeInTheDocument();
  });

  test('a zero cost is still a figure and keeps its chip', () => {
    // 0 is falsy; only an explicit null check keeps "no cost impact" visible
    // instead of silently looking like missing data.
    renderCard({ ...ALERT, estimated_cost: 0 });

    expect(screen.getByText('Est. $0')).toBeInTheDocument();
  });
});

describe('AIAlertCard — actions', () => {
  test('offers exactly Accept and Dismiss', () => {
    renderCard();

    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  test('Accept reports this prediction id and does not also dismiss it', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(onAccept).toHaveBeenCalledExactlyOnceWith('pred-1');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('Dismiss reports this prediction id and does not also accept it', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('pred-1');
    expect(onAccept).not.toHaveBeenCalled();
  });

  test('each card reports its own id, not the first one rendered', () => {
    renderCard({ ...ALERT, id: 'pred-9' });

    screen.getByRole('button', { name: 'Accept' }).click();

    expect(onAccept).toHaveBeenCalledWith('pred-9');
  });
});

describe('AIAlertCard — busy', () => {
  test('busy disables both actions so the request cannot be fired twice', () => {
    renderCard(ALERT, { busy: true });

    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
  });

  test('a click while busy reaches neither handler', () => {
    renderCard(ALERT, { busy: true });

    // fireEvent, not userEvent: MUI gives a disabled button
    // `pointer-events: none`, which userEvent refuses to click through. Firing
    // the event straight at the element is the stronger check anyway — it
    // proves the handler stays silent even if a click does land on it.
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onAccept).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test('both actions are live when not busy', () => {
    renderCard();

    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });
});
