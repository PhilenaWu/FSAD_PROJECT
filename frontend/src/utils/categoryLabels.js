// Display translation for the category enum (utils/inspectionOptions.js) —
// a fixed 11-value list, not free text, so this is a static lookup table
// rather than an OpenAI call (contrast with openaiService.translate*, which
// handles what people actually wrote). The stored value and every backend
// CHECK constraint stay the English string regardless of what's shown here.
//
// Translations are a best effort, not reviewed by a native speaker of each
// language — this table is the one place to correct a wrong word if someone
// flags it.
const CATEGORY_LABELS = {
  Structural: { zh: '结构', ms: 'Struktur', ta: 'கட்டமைப்பு' },
  Electrical: { zh: '电气', ms: 'Elektrik', ta: 'மின்சாரம்' },
  Plumbing: { zh: '水管', ms: 'Paip', ta: 'குழாய்' },
  Cleanliness: { zh: '清洁', ms: 'Kebersihan', ta: 'சுத்தம்' },
  Lift: { zh: '电梯', ms: 'Lif', ta: 'லிப்ட்' },
  Doors: { zh: '门', ms: 'Pintu', ta: 'கதவுகள்' },
  Cabin: { zh: '轿厢', ms: 'Kabin', ta: 'கேபின்' },
  Safety: { zh: '安全', ms: 'Keselamatan', ta: 'பாதுகாப்பு' },
  Landscaping: { zh: '园艺', ms: 'Landskap', ta: 'இயற்கை அமைப்பு' },
  Pest: { zh: '虫害', ms: 'Perosak', ta: 'பூச்சி' },
  Miscellaneous: { zh: '其他', ms: 'Lain-lain', ta: 'பல்வேறு' },
};

/**
 * Display label for a category, in `lang` if we have one, else the raw
 * English enum value (also the fallback for 'en' itself, and for a category
 * or language this table doesn't recognise).
 */
export function categoryLabel(category, lang) {
  if (!lang || lang === 'en') return category;
  return CATEGORY_LABELS[category]?.[lang] ?? category;
}
