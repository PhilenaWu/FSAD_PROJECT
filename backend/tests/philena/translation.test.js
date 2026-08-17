// Unit tests for openaiService.translateInspectionText — a manager (or any
// staff role) reading a report written in a language they don't read, via
// their own preferred_language (Profile page). No live API: the OpenAI SDK
// is mocked, and config/env is mocked to toggle OPENAI_API_KEY. Same
// convention as tests/mahdiya/openaiService.test.js.
'use strict';

const mockConfig = { OPENAI_API_KEY: undefined };
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
  mockConfig.OPENAI_API_KEY = undefined;
});

// A JSON success response, matching the shape the prompt asks for.
function jsonResponse(body) {
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
}

describe('translateInspectionText', () => {
  test('throws serviceUnavailable when no API key is configured', async () => {
    await expect(
      openaiService.translateInspectionText({ title: 'a', description: 'b' }, 'zh')
    ).rejects.toMatchObject({ serviceUnavailable: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('rejects an unsupported target language before even checking the key', async () => {
    // No API key set here either — the point is that this fails for being an
    // unsupported code, not for a missing key, and does so first.
    await expect(
      openaiService.translateInspectionText({ title: 'a', description: 'b' }, 'fr')
    ).rejects.toThrow(/unsupported target language/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns the translated title/description on success', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(
      jsonResponse({ title: '漏水的管道', description: '厨房水槽下方。', was_translated: true })
    );

    const result = await openaiService.translateInspectionText(
      { title: 'Leaking pipe', description: 'Under the kitchen sink.' },
      'zh'
    );

    expect(result).toEqual({
      title: '漏水的管道',
      description: '厨房水槽下方。',
      was_translated: true,
    });
  });

  test('the prompt names the target language and both source fields', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(
      jsonResponse({ title: 'x', description: 'y', was_translated: true })
    );

    await openaiService.translateInspectionText(
      { title: 'Leaking pipe', description: 'Under the kitchen sink.' },
      'ta'
    );

    const [call] = mockCreate.mock.calls;
    const prompt = call[0].messages[0].content;
    expect(prompt).toMatch(/Tamil/);
    expect(prompt).toMatch(/Leaking pipe/);
    expect(prompt).toMatch(/Under the kitchen sink\./);
    expect(call[0].response_format).toEqual({ type: 'json_object' });
  });

  test('a blank description is sent as "(none given)", not an empty line', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(
      jsonResponse({ title: 'x', description: '', was_translated: true })
    );

    await openaiService.translateInspectionText({ title: 'Leaking pipe', description: '' }, 'zh');

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/\(none given\)/);
  });

  // The model is asked to say so explicitly (was_translated), rather than the
  // caller diffing strings — a title that's just a block number reads the
  // same in every language, which isn't the same claim as "already in Malay".
  test('was_translated: false is preserved — text already in the target language', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(
      jsonResponse({ title: '44A #12-05', description: '', was_translated: false })
    );

    const result = await openaiService.translateInspectionText(
      { title: '44A #12-05', description: '' },
      'en'
    );

    expect(result.was_translated).toBe(false);
  });

  test('a missing was_translated defaults to true rather than silently false', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(jsonResponse({ title: 'x', description: 'y' }));

    const result = await openaiService.translateInspectionText(
      { title: 'a', description: 'b' },
      'zh'
    );

    expect(result.was_translated).toBe(true);
  });

  test('rejects with serviceUnavailable when the API call itself fails', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockRejectedValueOnce(new Error('network error'));

    await expect(
      openaiService.translateInspectionText({ title: 'a', description: 'b' }, 'zh')
    ).rejects.toMatchObject({ serviceUnavailable: true });
  });

  test('rejects when the response is not valid JSON', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] });

    await expect(
      openaiService.translateInspectionText({ title: 'a', description: 'b' }, 'zh')
    ).rejects.toThrow(/not valid JSON/i);
  });

  test('rejects when the response has no translated title', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(jsonResponse({ description: 'y' }));

    await expect(
      openaiService.translateInspectionText({ title: 'a', description: 'b' }, 'zh')
    ).rejects.toThrow(/missing a translated title/i);
  });
});

// translateReportExtras (048) — the OTHER half of translation: what a
// resident's own MyReportsPage card shows that someone ELSE wrote (a
// manager's closing remark, checklist remarks, history notes), not the
// resident's own title/description.
describe('translateReportExtras', () => {
  test('nothing to translate short-circuits before even checking the key', async () => {
    // No API key set — the point is this returns cleanly regardless.
    const result = await openaiService.translateReportExtras(
      { closing_remark: null, checklist_results: [], history: [] },
      'zh'
    );

    expect(result).toEqual({
      closing_remark: null,
      checklist_remarks: [],
      history_notes: [],
      was_translated: false,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('a checklist item and a history entry with no text also count as nothing to translate', async () => {
    const result = await openaiService.translateReportExtras(
      {
        closing_remark: null,
        checklist_results: [{ id: 'chk-1', remark: null }],
        history: [{ id: 'hist-1', note: null }],
      },
      'zh'
    );

    expect(result.was_translated).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('rejects an unsupported target language before checking the key or the text', async () => {
    await expect(
      openaiService.translateReportExtras(
        { closing_remark: 'Fixed it.', checklist_results: [], history: [] },
        'fr'
      )
    ).rejects.toThrow(/unsupported target language/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('throws serviceUnavailable when there is text to translate but no API key', async () => {
    await expect(
      openaiService.translateReportExtras(
        { closing_remark: 'Fixed it.', checklist_results: [], history: [] },
        'zh'
      )
    ).rejects.toMatchObject({ serviceUnavailable: true });
  });

  test('sends only the remarks/notes that have text, and returns the translated shape', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce(
      jsonResponse({
        closing_remark: '已更换按钮模块。',
        checklist_remarks: [{ id: 'chk-1', remark: '门卡在门槛上' }],
        history_notes: [{ id: 'hist-1', note: '已检查，一切正常' }],
        was_translated: true,
      })
    );

    const result = await openaiService.translateReportExtras(
      {
        closing_remark: 'Replaced the button module.',
        checklist_results: [
          { id: 'chk-1', remark: 'Door catches on the sill' },
          { id: 'chk-2', remark: null }, // no text — must not reach the prompt
        ],
        history: [
          { id: 'hist-1', note: 'Checked, all good' },
          { id: 'hist-2', note: null }, // no text — must not reach the prompt
        ],
      },
      'zh'
    );

    expect(result).toEqual({
      closing_remark: '已更换按钮模块。',
      checklist_remarks: [{ id: 'chk-1', remark: '门卡在门槛上' }],
      history_notes: [{ id: 'hist-1', note: '已检查，一切正常' }],
      was_translated: true,
    });

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/chk-1/);
    expect(prompt).toMatch(/Door catches on the sill/);
    expect(prompt).toMatch(/hist-1/);
    expect(prompt).toMatch(/Checked, all good/);
    expect(prompt).not.toMatch(/chk-2/);
    expect(prompt).not.toMatch(/hist-2/);
  });

  test('rejects with serviceUnavailable when the API call itself fails', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockRejectedValueOnce(new Error('network error'));

    await expect(
      openaiService.translateReportExtras(
        { closing_remark: 'Fixed it.', checklist_results: [], history: [] },
        'zh'
      )
    ).rejects.toMatchObject({ serviceUnavailable: true });
  });

  test('rejects when the response is not valid JSON', async () => {
    mockConfig.OPENAI_API_KEY = 'test-key';
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] });

    await expect(
      openaiService.translateReportExtras(
        { closing_remark: 'Fixed it.', checklist_results: [], history: [] },
        'zh'
      )
    ).rejects.toThrow(/not valid JSON/i);
  });
});
