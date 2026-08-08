// Mahdiya — individual contribution tests: UC-013 paper-form OCR reliability.
//
// Covers src/services/openaiService.js (extractSpotCheckForm): a wrong item
// count from the vision model is usually one checklist item wrongly split
// into two entries. item_number lets that be recovered without discarding
// the whole scan, and a failed attempt now tells the retry what went wrong
// instead of just re-asking the same question. No live API — the OpenAI SDK
// is mocked.
'use strict';

const mockConfig = { OPENAI_API_KEY: 'test-key' };
jest.mock('../../src/config/env', () => mockConfig);

const mockCreate = jest.fn();
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }))
);

const openaiService = require('../../src/services/openaiService');

beforeEach(() => {
  mockCreate.mockReset();
});

const itemTexts = ['Motor room cleanliness - Any debris?', 'Bearings - Any abnormal noise?'];
const scanResponse = (items, extra = {}) => ({
  choices: [{ message: { content: JSON.stringify({ serviced_at: null, serviced_at_confidence: 0, ...extra, items }) } }],
});

describe('extractSpotCheckForm — overcount recovery via item_number', () => {
  it('recovers the correct answers when one item is wrongly split in two, without retrying', async () => {
    mockCreate.mockResolvedValueOnce(
      scanResponse([
        { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.95 },
        { item_number: 2, result: 'Defect', remark: 'Grinding noise', field_confidence: 0.8 },
        { item_number: 2, result: 'Pass', remark: null, field_confidence: 0.3 }, // the stray split entry
      ])
    );

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    expect(mockCreate).toHaveBeenCalledTimes(1); // no retry needed
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({ result: 'Defect', remark: 'Grinding noise', field_confidence: 0.8 });
  });

  it('falls back to a retry when item_number leaves a genuine gap instead of guessing', async () => {
    mockCreate
      .mockResolvedValueOnce(
        scanResponse([
          { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
          { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
          { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 }, // item 2 never claimed
        ])
      )
      .mockResolvedValueOnce(
        scanResponse([
          { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
          { item_number: 2, result: 'Defect', remark: 'Loose bolt', field_confidence: 0.85 },
        ])
      );

    const result = await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.items[1].remark).toBe('Loose bolt');
  });
});

describe('extractSpotCheckForm — failure-aware retry prompt', () => {
  it('tells the second attempt what specifically went wrong on the first', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not valid json' } }] })
      .mockResolvedValueOnce(
        scanResponse([
          { item_number: 1, result: 'Pass', remark: null, field_confidence: 0.9 },
          { item_number: 2, result: 'Pass', remark: null, field_confidence: 0.9 },
        ])
      );

    await openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts);

    const firstPrompt = mockCreate.mock.calls[0][0].messages[0].content[0].text;
    const secondPrompt = mockCreate.mock.calls[1][0].messages[0].content[0].text;
    expect(firstPrompt).not.toContain('previous attempt was rejected');
    expect(secondPrompt).toContain('previous attempt was rejected');
    expect(secondPrompt).toContain('not valid JSON');
  });

  it('gives up after 3 attempts rather than retrying forever', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'not valid json' } }] });

    await expect(
      openaiService.extractSpotCheckForm('https://example.com/form.jpg', itemTexts)
    ).rejects.toThrow(/not valid JSON/);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
