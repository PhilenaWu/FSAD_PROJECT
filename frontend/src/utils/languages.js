// Display-language options — what a user wants OTHER people's free text
// translated into, for their own reading. Every role can set this (Profile
// page); it's separate from voiceService.js's VOICE_LANGUAGES, which is a
// speech-recognition *input* setting (residents dictating a report) and
// includes an en-SG/en-US accent split that means nothing as a translation
// target. Codes match the backend's users.preferred_language CHECK
// constraint (migration 047) — keep the two in sync if this list changes.
export const DISPLAY_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文 (Mandarin)' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
];

/** Display label for a language code; the code itself if it's unrecognised. */
export function languageLabel(code) {
  return DISPLAY_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

// Cheap, client-side "does this need a closer look" signal for a table row —
// not a real language detector. Only catches script, not language: Mandarin
// (CJK) and Tamil are unmistakable by character range alone, so those two are
// enough to flag "translate before reading this row's title". Malay and
// English both use the Latin alphabet, so neither is (or needs to be)
// distinguishable this way — the actual translation still asks the model to
// detect the language properly; this only decides whether to show the icon.
//
// Numeric code-point comparisons rather than a regex unicode range: a range
// boundary written as a literal glyph in source is a byte a diff or an editor
// re-encoding could silently corrupt without looking wrong; a plain integer
// comparison can't drift that way.
const CJK_RANGE = [0x4e00, 0x9fff]; // CJK Unified Ideographs
const TAMIL_RANGE = [0x0b80, 0x0bff]; // Tamil block

function inRange(codePoint, [start, end]) {
  return codePoint >= start && codePoint <= end;
}

/** True if `text` contains a Mandarin or Tamil character. */
export function looksNonLatin(text) {
  for (const ch of text ?? '') {
    const cp = ch.codePointAt(0);
    if (inRange(cp, CJK_RANGE) || inRange(cp, TAMIL_RANGE)) return true;
  }
  return false;
}
