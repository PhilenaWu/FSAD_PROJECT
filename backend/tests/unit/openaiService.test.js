// Unit tests for openaiService.generateRiskAlert (UC-006). No live API: the
// OpenAI SDK is mocked, and config/env is mocked to toggle OPENAI_API_KEY.
'use strict';

// Mutable config so each test can flip the key. openaiService reads
// config.OPENAI_API_KEY at call time.
const mockConfig = { OPENAI_API_KEY: undefined };
jest.mock('../../src/config/env', () => mockConfig);

// Mock the OpenAI SDK: a class whose chat.completions.create is a jest fn.
const mockCreate = jest.fn();
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }))
);

const openaiService = require('../../src/services/openaiService');

beforeEach(() => {
  mockCreate.mockReset();
  mockConfig.OPENAI_API_KEY = undefined;
});

describe('generateRiskAlert', () => {
  test('returns the deterministic, data-driven fallback when no API key is configured', async () => {
    const text = await openaiService.generateRiskAlert('44A', 'Lift', 150, 1200);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(text).toMatch(/^High risk:/); // professional format
    expect(text).toMatch(/Block 44A/);
    expect(text).toMatch(/Lift/);
    expect(text).toMatch(/increased by 150%/);
    expect(text).toMatch(/\$1,200/); // projected cost included
    // category-specific action, not generic filler
    expect(text).toMatch(/lift cable and brake inspection/i);
    expect(text).not.toMatch(/take preventive action/i);
  });

  test('fallback tailors the preventive action to the defect category', async () => {
    const lift = await openaiService.generateRiskAlert('A', 'Lift', 150, null);
    const electrical = await openaiService.generateRiskAlert('A', 'Electrical', 150, null);
    const plumbing = await openaiService.generateRiskAlert('A', 'Plumbing', 150, null);

    expect(lift).toMatch(/lift cable and brake inspection/i);
    expect(electrical).toMatch(/electrical safety inspection/i);
    expect(plumbing).toMatch(/leaks/i);
    // the three recommendations must genuinely differ
    expect(new Set([lift, electrical, plumbing]).size).toBe(3);
  });

  test('fallback omits the cost sentence when estimated_cost is null', async () => {
    const text = await openaiService.generateRiskAlert('44A', 'Lift', 150, null);
    expect(text).not.toMatch(/cost impact/i);
  });

  test('returns the model text when the API key is set and the call succeeds', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '  Block 44A lift failures rising — act now.  ' } }],
    });

    const text = await openaiService.generateRiskAlert('44A', 'Lift', 150, 1200);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(text).toBe('Block 44A lift failures rising — act now.'); // trimmed
  });

  test('falls back gracefully when the OpenAI call throws (UC-006 E1)', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockRejectedValueOnce(new Error('rate limited'));

    const text = await openaiService.generateRiskAlert('44A', 'Lift', 150, 1200);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(text).toMatch(/Block 44A/); // template, not a thrown error
  });

  test('falls back when the model returns empty content', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '' } }] });

    const text = await openaiService.generateRiskAlert('44A', 'Lift', 150, 1200);
    expect(text).toMatch(/Block 44A/);
  });
});

describe('extractSpotCheckForm (UC-013)', () => {
  const itemTexts = ['Motor room cleanliness - Any debris?', 'Bearings - Any abnormal noise?'];

  test('OCR-T01: a clean mocked scan maps every item, in order', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            serviced_at: '2026-03-22',
            serviced_at_confidence: 0.92,
            form_lift_code: '44A-L1',
            items: [
              { result: 'Pass', remark: null, field_confidence: 0.95 },
              { result: 'Defect', remark: 'Slight grinding noise', field_confidence: 0.81 },
            ],
          }),
        },
      }],
    });

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    expect(result.serviced_at).toBe('2026-03-22');
    expect(result.form_lift_code).toBe('44A-L1');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ result: 'Pass', remark: null, field_confidence: 0.95 });
    expect(result.items[1]).toEqual({
      result: 'Defect', remark: 'Slight grinding noise', field_confidence: 0.81,
    });
    // M.6: never a severity or photo field, on any item.
    expect(result.items[0]).not.toHaveProperty('severity');
    expect(result.items[0]).not.toHaveProperty('photo_url');
  });

  test('OCR-T02: a partial scan keeps readable items and marks the rest unreadable', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            serviced_at: null,
            serviced_at_confidence: 0,
            items: [
              { result: 'Pass', remark: null, field_confidence: 0.9 },
              { result: 'unreadable', remark: null, field_confidence: 0.1 },
            ],
          }),
        },
      }],
    });

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    expect(result.serviced_at).toBeNull();
    expect(result.items[0].result).toBe('Pass');
    expect(result.items[1].result).toBe('unreadable');
  });

  test('sends the live item texts in the prompt and requests strict JSON', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            serviced_at: null, serviced_at_confidence: 0,
            items: [
              { result: 'Pass', remark: null, field_confidence: 0.9 },
              { result: 'Pass', remark: null, field_confidence: 0.9 },
            ],
          }),
        },
      }],
    });

    await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    const call = mockCreate.mock.calls[0][0];
    expect(call.response_format).toEqual({ type: 'json_object' });
    const promptText = call.messages[0].content[0].text;
    expect(promptText).toContain(itemTexts[0]);
    expect(promptText).toContain(itemTexts[1]);
    const imagePart = call.messages[0].content[1];
    expect(imagePart).toEqual({ type: 'image_url', image_url: { url: 'https://example.com/form.jpg' } });
  });

  test('OCR-T03: throws when OPENAI_API_KEY is not configured (no silent fallback)', async () => {
    mockConfig.OPENAI_API_KEY = undefined;

    await expect(
      openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts)
    ).rejects.toThrow(/OPENAI_API_KEY/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // A4: no key configured is a service-unavailable condition, not a bad photo.
  test('marks the no-key error as serviceUnavailable (A4)', async () => {
    mockConfig.OPENAI_API_KEY = undefined;

    await expect(
      openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts)
    ).rejects.toMatchObject({ serviceUnavailable: true });
  });

  test('throws when the API call itself fails, marked serviceUnavailable (A4)', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockRejectedValueOnce(new Error('vision model overloaded'));

    await expect(
      openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts)
    ).rejects.toMatchObject({ message: 'vision model overloaded', serviceUnavailable: true });
  });

  // A bad response is retried up to MAX_ATTEMPTS - 1 times (see "recovers on
  // retry" below) — every attempt must fail here for the call to ultimately
  // throw.
  test('throws when the model response is not valid JSON on every attempt', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] });

    await expect(
      openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts)
    ).rejects.toThrow(/not valid JSON/);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  test('throws when the items array length does not match the input and item_number cannot recover it', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            serviced_at: null, serviced_at_confidence: 0,
            // Only 1, expected 2, and no item_number to recover item 2 from.
            items: [{ result: 'Pass', remark: null, field_confidence: 0.9 }],
          }),
        },
      }],
    });

    await expect(
      openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts)
    ).rejects.toThrow(/expected 2/);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  // Retrying with the exact same prompt tends to reproduce the exact same
  // mistake — telling the model what it got wrong last time gives the retry
  // a real chance to fix it instead of just re-rolling the dice.
  test('a retry prompt names the previous failure', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not json at all' } }] })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              serviced_at: null, serviced_at_confidence: 0,
              items: [
                { result: 'Pass', remark: null, field_confidence: 0.9 },
                { result: 'Pass', remark: null, field_confidence: 0.9 },
              ],
            }),
          },
        }],
      });

    await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    const firstPrompt = mockCreate.mock.calls[0][0].messages[0].content[0].text;
    const secondPrompt = mockCreate.mock.calls[1][0].messages[0].content[0].text;
    expect(firstPrompt).not.toContain('previous attempt was rejected');
    expect(secondPrompt).toContain('previous attempt was rejected');
    expect(secondPrompt).toContain('not valid JSON');
  });

  // The real failure this recovery was added for: one item wrongly split
  // into two entries. item_number says which numbered item each entry
  // actually answers, so the correct answer for every expected item can be
  // recovered on the spot — no retry, no rescan.
  test('reconciles an overcount via item_number instead of retrying', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            serviced_at: '2026-03-22', serviced_at_confidence: 0.9,
            items: [
              { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.95 },
              // Item 2 wrongly split into two entries — the first wins.
              { item_number: 2, result: 'Defect', remark: 'Noisy', field_confidence: 0.8 },
              { item_number: 2, result: 'Pass', remark: null, field_confidence: 0.4 },
            ],
          }),
        },
      }],
    });

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    expect(mockCreate).toHaveBeenCalledTimes(1); // recovered without a retry
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({ result: 'Defect', remark: 'Noisy', field_confidence: 0.8 });
    // item_number itself is bookkeeping, not part of the returned shape.
    expect(result.items[0]).not.toHaveProperty('item_number');
  });

  // An overcount where item_number leaves a genuine gap (nothing claims item
  // 2) can't be safely guessed at, so it must still fall through to a retry.
  test('falls through to a retry when item_number leaves a gap', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              serviced_at: null, serviced_at_confidence: 0,
              items: [
                { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
                { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
                { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
              ],
            }),
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              serviced_at: '2026-03-22', serviced_at_confidence: 0.9,
              items: [
                { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
                { item_number: 2, result: 'Defect', remark: 'Noisy', field_confidence: 0.8 },
              ],
            }),
          },
        }],
      });

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(2);
  });

  // Reproduces the real failure this retry was added for: the same photo
  // scanned twice can get a wrong item count on one attempt and a correct
  // one on the next (observed: 26 items back instead of 25 on a re-scan of
  // an identical image). The caller should not have to rescan by hand.
  test('recovers on retry when the first attempt returns the wrong item count', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              serviced_at: null, serviced_at_confidence: 0,
              items: [
                { result: 'Pass', remark: null, field_confidence: 0.9 },
                { result: 'Pass', remark: null, field_confidence: 0.9 },
                { result: 'Pass', remark: null, field_confidence: 0.9 }, // extra — 3, expected 2
              ],
            }),
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              serviced_at: '2026-03-22', serviced_at_confidence: 0.9,
              items: [
                { result: 'Pass', remark: null, field_confidence: 0.9 },
                { result: 'Defect', remark: 'Noisy', field_confidence: 0.8 },
              ],
            }),
          },
        }],
      });

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[1].remark).toBe('Noisy');
  });

  // A real outage shouldn't be retried — it will just fail the same way again.
  test('does not retry a serviceUnavailable failure', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockRejectedValue(new Error('vision model overloaded'));

    await expect(
      openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts)
    ).rejects.toMatchObject({ serviceUnavailable: true });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('an invalid per-item result falls back to "unreadable" rather than throwing', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            serviced_at: null, serviced_at_confidence: 0,
            items: [
              { result: 'Maybe', remark: null, field_confidence: 0.5 },
              { result: 'Pass', remark: null, field_confidence: 0.9 },
            ],
          }),
        },
      }],
    });

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);
    expect(result.items[0].result).toBe('unreadable');
  });
});
