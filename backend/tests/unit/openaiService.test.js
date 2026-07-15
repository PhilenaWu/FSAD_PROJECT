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
  test('returns the deterministic fallback when no API key is configured', async () => {
    const text = await openaiService.generateRiskAlert('44A', 'Lift', 150, 1200);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(text).toMatch(/Block 44A/);
    expect(text).toMatch(/Lift/);
    expect(text).toMatch(/150%/);
    expect(text).toMatch(/\$1,200/); // projected cost included
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
