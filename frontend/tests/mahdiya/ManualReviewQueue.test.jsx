// ManualReviewQueue (UC-007) lists low-confidence CV detections and lets a
// manager confirm one into a real ticket or dismiss it as a false positive.
// Self-fetching, so the service layer is mocked rather than passed as props.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/services/cvService', () => ({
  getManualReviewQueue: vi.fn(),
  createTicketFromDetection: vi.fn(),
  dismissDetection: vi.fn(),
}));

import { createTicketFromDetection, dismissDetection, getManualReviewQueue } from '../../src/services/cvService';
import ManualReviewQueue from '../../src/components/cv/ManualReviewQueue';

const DETECTIONS = [
  {
    id: 'det-1',
    image_url: 'https://example.com/det-1.jpg',
    defect_class: 'crack',
    confidence: 0.42,
    bounding_box: { x: 100, y: 100, width: 40, height: 40 },
    source: 'resident_upload',
    detected_at: '2026-08-08T09:00:00Z',
    location_block: '44A',
  },
  {
    id: 'det-2',
    image_url: 'https://example.com/det-2.jpg',
    defect_class: null,
    confidence: 0.35,
    bounding_box: null,
    source: 'scheduled_scan',
    detected_at: '2026-08-08T10:00:00Z',
    location_block: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ManualReviewQueue — loading and empty states', () => {
  test('shows nothing needing review once an empty queue resolves', async () => {
    getManualReviewQueue.mockResolvedValue({ data: [] });
    render(<ManualReviewQueue />);

    expect(await screen.findByText(/No detections need manual review/)).toBeInTheDocument();
  });

  test('shows an error alert when the queue fails to load', async () => {
    getManualReviewQueue.mockRejectedValue(new Error('network error'));
    render(<ManualReviewQueue />);

    expect(await screen.findByText(/Could not load the manual review queue/)).toBeInTheDocument();
  });
});

describe('ManualReviewQueue — listing detections', () => {
  test('renders each detection with its class, confidence, and source', async () => {
    getManualReviewQueue.mockResolvedValue({ data: DETECTIONS });
    render(<ManualReviewQueue />);

    expect(await screen.findByText('crack')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText(/Resident upload/)).toBeInTheDocument();
    expect(screen.getByText('Unclassified')).toBeInTheDocument(); // det-2 has no defect_class
    expect(screen.getByText(/Scheduled scan/)).toBeInTheDocument();
  });
});

describe('ManualReviewQueue — create ticket flow', () => {
  async function openFirstCard(user) {
    getManualReviewQueue.mockResolvedValue({ data: DETECTIONS });
    render(<ManualReviewQueue />);
    await user.click(await screen.findByText('crack'));
  }

  test('pre-fills the block when the detection captured one', async () => {
    const user = userEvent.setup();
    await openFirstCard(user);

    expect(screen.getByLabelText('Block', { exact: false })).toHaveValue('44A');
    expect(screen.getByText(/Pre-filled from the original upload/)).toBeInTheDocument();
  });

  test('requires category, priority, and block before submitting', async () => {
    const user = userEvent.setup();
    await openFirstCard(user);

    // Category and Priority start blank. Submitting via a real click on the
    // <button type="submit"> would be blocked by the browser's own HTML5
    // "required" constraint validation before React's onSubmit ever runs —
    // so the component's own validation message would never be reachable
    // that way. Dispatching the submit event directly exercises the
    // component's own check instead. The dialog renders through a portal
    // (outside the render() container), so the form has to be found via the
    // document, not the local container.
    fireEvent.submit(document.querySelector('form'));

    expect(await screen.findByText(/are all required/)).toBeInTheDocument();
    expect(createTicketFromDetection).not.toHaveBeenCalled();
  });

  test('submits the form and removes the card from the queue on success', async () => {
    const user = userEvent.setup();
    createTicketFromDetection.mockResolvedValue({ id: 'insp-new' });
    await openFirstCard(user);

    await user.click(screen.getByLabelText('Category', { exact: false }));
    await user.click(await screen.findByRole('option', { name: 'Structural' }));
    await user.click(screen.getByLabelText('Priority', { exact: false }));
    await user.click(await screen.findByRole('option', { name: 'High' }));

    await user.click(screen.getByRole('button', { name: 'Create ticket' }));

    await waitFor(() =>
      expect(createTicketFromDetection).toHaveBeenCalledWith('det-1', {
        category: 'Structural',
        priority: 'High',
        location_block: '44A',
      })
    );
    // Dialog closes and the card is gone.
    expect(screen.queryByRole('button', { name: 'Create ticket' })).not.toBeInTheDocument();
    expect(screen.queryByText('crack')).not.toBeInTheDocument();
  });

  test('shows the server error message when creating the ticket fails', async () => {
    const user = userEvent.setup();
    createTicketFromDetection.mockRejectedValue({ response: { data: { message: 'Block is required.' } } });
    await openFirstCard(user);

    await user.click(screen.getByLabelText('Category', { exact: false }));
    await user.click(await screen.findByRole('option', { name: 'Structural' }));
    await user.click(screen.getByLabelText('Priority', { exact: false }));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    await user.click(screen.getByRole('button', { name: 'Create ticket' }));

    expect(await screen.findByText('Block is required.')).toBeInTheDocument();
    // Card stays and the dialog stays open — the failed attempt didn't
    // remove or close anything. Both the card and the dialog's own copy
    // mention "crack" (the guessed defect_class), so there are two matches.
    expect(screen.getAllByText('crack')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
  });
});

describe('ManualReviewQueue — dismiss flow', () => {
  test('dismissing removes the card without requiring the form to be filled', async () => {
    const user = userEvent.setup();
    getManualReviewQueue.mockResolvedValue({ data: DETECTIONS });
    dismissDetection.mockResolvedValue({ id: 'det-1', status: 'dismissed' });
    render(<ManualReviewQueue />);

    await user.click(await screen.findByText('crack'));
    await user.click(screen.getByRole('button', { name: /Dismiss/ }));

    await waitFor(() => expect(dismissDetection).toHaveBeenCalledWith('det-1'));
    expect(screen.queryByText('crack')).not.toBeInTheDocument();
    // The other card is untouched.
    expect(screen.getByText('Unclassified')).toBeInTheDocument();
  });
});
