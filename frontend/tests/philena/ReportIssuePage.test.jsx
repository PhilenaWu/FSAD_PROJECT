// UC-001 "Report an issue" — the resident's entry point to the whole system.
//
// What is under test is the page's own validation and submit contract: which
// fields it refuses to send without, what it puts in the multipart body, that
// it resets only after a success, and that each backend error code produces the
// right message. A wrong field name here means a report the backend rejects; a
// reset on failure means a resident loses everything they typed.
//
// The API, the photo compressor and the voice service are mocked; the form is
// real. Category became required when residents took over categorising their
// own reports, so it is covered as its own case.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// The whole frontend suite runs these files in parallel with two dozen others,
// and a full MUI page in jsdom is slow enough under that load to exceed
// testing-library's 1s default. Scoped to this file — vitest isolates modules
// per test file, so it cannot affect anyone else's suite.
configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/services/api', () => ({
  default: { post: vi.fn() },
}));

// Compression is exercised by its own unit tests; here it must not touch a real
// canvas, and the page must send whatever it returns.
vi.mock('../../src/utils/imageCompress', () => ({
  compressImage: vi.fn(async (file) => file),
}));

// The browser speech API does not exist in jsdom. Reporting it unsupported
// keeps the dictation button out of the way of most of these tests; the
// dictation describe block below overrides isSpeechSupported per test.
const mockIsSpeechSupported = vi.fn(() => false);
const mockStartRecognition = vi.fn();
vi.mock('../../src/services/voiceService', () => ({
  VOICE_LANGUAGES: [{ code: 'en-SG', label: 'English' }],
  isSpeechSupported: () => mockIsSpeechSupported(),
  startRecognition: (...args) => mockStartRecognition(...args),
}));

import api from '../../src/services/api';
import ReportIssuePage from '../../src/pages/ReportIssuePage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ReportIssuePage />
    </MemoryRouter>
  );
}

// MUI Selects are comboboxes, not <select> — open, then click the option.
// findByRole rather than getByRole: MUI's menu marks the rest of the page
// aria-hidden while open and restores it on a transition, so a combobox queried
// immediately after another select was used can briefly be invisible to the
// accessibility tree.
async function pickOption(user, fieldName, optionName) {
  const field = await screen.findByRole('combobox', { name: new RegExp(fieldName, 'i') }, { timeout: 5000 });
  await user.click(field);
  await user.click(await screen.findByRole('option', { name: optionName }, { timeout: 5000 }));
}

// The submit button is type="submit" inside a real <form>. Even with noValidate
// on the form, going through the button couples these tests to the browser's
// own required-field handling; submitting the form directly exercises the
// page's validation, which is what is being tested.
function submitForm() {
  fireEvent.submit(document.querySelector('form'));
}

// A filled-in, valid report.
async function fillValidReport(user) {
  // Required fields carry an asterisk in the rendered label, so match loosely.
  await user.type(screen.getByLabelText(/^Title/i, { exact: false }), 'Lift door not closing');
  await user.type(
    screen.getByLabelText(/^Description/i, { exact: false }),
    'Door judders and stops halfway.'
  );
  await pickOption(user, 'Block', '44A');
  await pickOption(user, 'Category', 'Lift');
}

// The FormData the page posted, as a plain object.
function postedBody() {
  const [, formData] = api.post.mock.calls[0];
  return Object.fromEntries(formData.entries());
}

describe('ReportIssuePage', () => {
  beforeEach(() => {
    // restoreMocks only restores spies; a vi.fn() from a module factory keeps
    // its call history between tests unless it is reset here.
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { id: 'insp-1' } });
    mockIsSpeechSupported.mockReset().mockReturnValue(false);
    mockStartRecognition.mockReset();
  });

  describe('validation', () => {
    test('refuses an empty form and names the three required fields', async () => {
      renderPage();

      submitForm();

      expect(
        await screen.findByText('Title, block and category are required.')
      ).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    test('a title of only spaces does not count as a title', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await user.type(screen.getByLabelText(/^Title/i, { exact: false }), '   ');
      await pickOption(user, 'Block', '44A');
      await pickOption(user, 'Category', 'Lift');

      submitForm();

      expect(
        await screen.findByText('Title, block and category are required.')
      ).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    test('block alone is not enough — category is required too', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await user.type(screen.getByLabelText(/^Title/i, { exact: false }), 'Cracked tile');
      await pickOption(user, 'Block', '44A');

      submitForm();

      expect(
        await screen.findByText('Title, block and category are required.')
      ).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    test('description is optional — a report submits without one', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await user.type(screen.getByLabelText(/^Title/i, { exact: false }), 'Cracked tile');
      await pickOption(user, 'Block', '44A');
      await pickOption(user, 'Category', 'Structural');

      submitForm();

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    });
  });

  describe('submitting', () => {
    test('posts the fields the backend expects', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);

      submitForm();

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      const [url] = api.post.mock.calls[0];
      expect(url).toBe('/api/inspections');
      expect(postedBody()).toMatchObject({
        title: 'Lift door not closing',
        description: 'Door judders and stops halfway.',
        location_block: '44A',
        category: 'Lift',
      });
    });

    // An empty unit is left out rather than sent blank: location_unit is
    // optional, and '' is not the same as "not given".
    test('omits the unit when it is left blank', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);

      submitForm();

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(postedBody()).not.toHaveProperty('location_unit');
    });

    test('sends the unit when one is given', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);
      await user.type(screen.getByLabelText(/^Unit/i, { exact: false }), '#12-05');

      submitForm();

      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(postedBody().location_unit).toBe('#12-05');
    });

    test('confirms success and clears the form for the next report', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);

      submitForm();

      expect(
        await screen.findByText(/Report submitted — a manager will review it/i)
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^Title/i, { exact: false })).toHaveValue('');
      expect(screen.getByLabelText(/^Description/i, { exact: false })).toHaveValue('');
    });
  });

  describe('when the backend refuses it', () => {
    // The resident's typing is the expensive thing on this page. A failed
    // submit must leave every field exactly as it was so they can retry.
    test('keeps what was typed when the submit fails', async () => {
      api.post.mockRejectedValue({ response: { data: { code: 'SERVER_ERROR' } } });
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);

      submitForm();

      expect(
        await screen.findByText(/Something went wrong submitting your report/i)
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^Title/i, { exact: false })).toHaveValue(
        'Lift door not closing'
      );
    });

    test('shows the backend message on a validation error', async () => {
      api.post.mockRejectedValue({
        response: { data: { code: 'VALIDATION_ERROR', message: 'category must be one of: …' } },
      });
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);

      submitForm();

      expect(await screen.findByText('category must be one of: …')).toBeInTheDocument();
    });

    test('explains an over-size photo rather than blaming the report', async () => {
      api.post.mockRejectedValue({ response: { data: { code: 'PHOTO_TOO_LARGE' } } });
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);

      submitForm();

      expect(await screen.findByText(/That photo is too large/i)).toBeInTheDocument();
    });

    // A double submit is the resident's mistake to be told about gently, not an
    // error — hence a warning rather than the red failure wording.
    test('treats a duplicate as a warning, not a failure', async () => {
      api.post.mockRejectedValue({ response: { data: { code: 'DUPLICATE_SUBMISSION' } } });
      const user = userEvent.setup({ delay: null });
      renderPage();
      await fillValidReport(user);

      submitForm();

      const alert = await screen.findByText(/You just submitted this/i);
      expect(alert).toBeInTheDocument();
      expect(within(alert.closest('.MuiAlert-root')).queryByText(/went wrong/i)).toBeNull();
    });
  });

  describe('voice dictation', () => {
    // startRecognition's real onResult/onEnd callbacks are exercised here
    // directly, standing in for the browser actually recognising speech.
    function micButton(name) {
      return screen.getByRole('button', { name });
    }

    beforeEach(() => {
      mockIsSpeechSupported.mockReturnValue(true);
      // A truthy return is what makes the page commit to "recording started"
      // (see ReportIssuePage's toggleVoice) — mirrors the real SpeechRecognition
      // instance startRecognition() normally hands back.
      mockStartRecognition.mockReturnValue({ stop: vi.fn() });
    });

    test('title has its own mic, independent of description\'s', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();

      await user.click(micButton('Dictate title'));

      expect(mockStartRecognition).toHaveBeenCalledTimes(1);
      const { onResult } = mockStartRecognition.mock.calls[0][0];
      act(() => onResult('Lift door broken', ''));

      expect(screen.getByLabelText(/^Title/i, { exact: false })).toHaveValue('Lift door broken');
      expect(screen.getByLabelText(/^Description/i, { exact: false })).toHaveValue('');
    });

    test('description dictation still lands in Description, not Title', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();

      await user.click(micButton('Dictate description'));

      const { onResult } = mockStartRecognition.mock.calls[0][0];
      act(() => onResult('Door judders halfway.', ''));

      expect(screen.getByLabelText(/^Description/i, { exact: false })).toHaveValue(
        'Door judders halfway.'
      );
      expect(screen.getByLabelText(/^Title/i, { exact: false })).toHaveValue('');
    });

    // Only one recognition session makes sense at a time — starting title's
    // mic mid-description-dictation would otherwise silently drop input.
    test('the other field\'s mic is disabled while one is dictating', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();

      await user.click(micButton('Dictate title'));

      expect(micButton('Dictate description')).toBeDisabled();
      expect(mockStartRecognition).toHaveBeenCalledTimes(1);
    });

    test('stopping dictation re-enables the other field\'s mic', async () => {
      const user = userEvent.setup({ delay: null });
      renderPage();

      await user.click(micButton('Dictate title'));
      const { onEnd } = mockStartRecognition.mock.calls[0][0];
      act(() => onEnd());

      expect(await screen.findByRole('button', { name: 'Dictate description' })).toBeEnabled();
    });
  });
});
