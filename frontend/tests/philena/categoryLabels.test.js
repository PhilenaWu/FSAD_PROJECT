// categoryLabel — a static display translation for the fixed category enum,
// distinct from the AI translation pipeline (openaiService.translate*) that
// handles free text. No network, no caching: it's a lookup table.
import { describe, expect, test } from 'vitest';
import { categoryLabel } from '../../src/utils/categoryLabels';

describe('categoryLabel', () => {
  test('returns the English value unchanged when no language is given', () => {
    expect(categoryLabel('Lift', undefined)).toBe('Lift');
    expect(categoryLabel('Lift', '')).toBe('Lift');
  });

  test("returns the English value unchanged for lang 'en'", () => {
    expect(categoryLabel('Lift', 'en')).toBe('Lift');
  });

  test('translates a known category into each supported language', () => {
    expect(categoryLabel('Lift', 'zh')).toBe('电梯');
    expect(categoryLabel('Lift', 'ms')).toBe('Lif');
    expect(categoryLabel('Lift', 'ta')).toBe('லிப்ட்');
  });

  test('every CATEGORIES entry has a translation for every supported language', async () => {
    const { CATEGORIES } = await import('../../src/utils/inspectionOptions');
    for (const category of CATEGORIES) {
      for (const lang of ['zh', 'ms', 'ta']) {
        expect(categoryLabel(category, lang)).not.toBe(category);
      }
    }
  });

  test('falls back to the raw value for an unrecognised category', () => {
    expect(categoryLabel('NotARealCategory', 'zh')).toBe('NotARealCategory');
  });
});
