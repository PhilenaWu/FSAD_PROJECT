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
