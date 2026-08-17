// AI helpers for incidents. categoriseIncident is STUBBED so UC-001 works
// without an API key. generateRiskAlert (UC-006) calls OpenAI to phrase a risk
// alert and falls back to a deterministic, data-driven template when the key is
// missing or the API errors (UC-006 E1: graceful degradation). extractSpotCheckForm
// (UC-013) reads a photographed paper form via vision — unlike the others it has
// no deterministic fallback, so it throws on any failure instead.
'use strict';

const config = require('../config/env');

// Categorise an incident from its title/description.
// Returns { category, priority_score } where category is one of the values
// allowed by the incidents.category CHECK constraint and priority_score is 1-100.
//
// TODO: wire in the real OpenAI call here (using OPENAI_API_KEY) — send the
// title/description and parse the model's category + priority. For now we return
// a safe default so the create path is testable without a key.
async function categoriseIncident(title, description) {
  return { category: 'Miscellaneous', priority_score: 50 };
}

// Specific preventive action per defect category (keys match the inspections
// category CHECK constraint). Used to make every alert's recommendation concrete
// and category-appropriate rather than a generic "take preventive action".
const CATEGORY_ACTIONS = {
  Structural: 'commission a structural survey of the affected units',
  Electrical: 'schedule a licensed electrical safety inspection',
  Plumbing: 'inspect risers and joints for leaks and service the pipework',
  Cleanliness: 'increase cleaning frequency and audit waste disposal',
  Lift: 'schedule a professional lift cable and brake inspection',
  Doors: 'service the door hinges, closers, and access hardware',
  Cabin: 'inspect the lift cabin fixtures and interior panels',
  Safety: 'conduct a safety-equipment audit (alarms, signage, extinguishers)',
  Landscaping: 'schedule grounds maintenance and a pathway/tree inspection',
  Pest: 'arrange professional pest-control treatment',
  Miscellaneous: 'conduct a targeted preventive inspection of the affected area',
};

/**
 * The recommended preventive action for a category (falls back to a generic
 * targeted inspection for unknown categories).
 * @param {string} category
 * @returns {string}
 */
function actionFor(category) {
  return CATEGORY_ACTIONS[category] || CATEGORY_ACTIONS.Miscellaneous;
}

/**
 * Deterministic, data-driven fallback alert (<=60 words). Used when OpenAI is
 * unavailable so runAnalysis always produces specific card text. Injects the
 * block, category, exact velocity, the category-specific action, and the
 * projected cost — never generic filler.
 *
 * @param {string} block
 * @param {string} category
 * @param {number} velocity_pct
 * @param {number|null} estimated_cost
 * @returns {string}
 */
function fallbackAlert(block, category, velocity_pct, estimated_cost) {
  const rise = Math.round(velocity_pct);
  const action = actionFor(category);
  const cost =
    estimated_cost != null
      ? ` Projected cost impact: about $${Math.round(estimated_cost).toLocaleString()}.`
      : '';
  return (
    `High risk: ${category} defects in Block ${block} increased by ${rise}%. ` +
    `Recommended action: ${action}.${cost} Immediate inspection recommended.`
  );
}

/**
 * Generate a specific, professional risk alert (<=60 words) for a rising defect
 * trend. The prompt includes the block, category, the exact velocity_pct, and
 * the estimated_cost, and asks for a preventive action tailored to the defect
 * category. Calls OpenAI when OPENAI_API_KEY is configured; otherwise (or on any
 * API error) returns the deterministic, data-driven fallback template.
 *
 * @param {string} block - location block, e.g. '44A'.
 * @param {string} category - defect category, e.g. 'Lift'.
 * @param {number} velocity_pct - percentage rise vs the prior 30 days.
 * @param {number|null} estimated_cost - projected cost impact, or null.
 * @returns {Promise<string>} the alert text (never throws — falls back instead).
 */
async function generateRiskAlert(block, category, velocity_pct, estimated_cost) {
  const fallback = fallbackAlert(block, category, velocity_pct, estimated_cost);
  if (!config.OPENAI_API_KEY) {
    return fallback;
  }

  try {
    // Lazy require so the SDK is only loaded when a key is present (keeps the
    // no-key path dependency-free and easy to test).
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

    const rise = Math.round(velocity_pct);
    const costLine =
      estimated_cost != null
        ? `Projected cost impact: about $${Math.round(estimated_cost)}.`
        : 'Cost impact unknown (no prior cost data).';

    const prompt =
      `Write a professional facilities risk alert in 60 words or fewer for an ` +
      `estate manager. Use these exact facts:\n` +
      `- Block: ${block}\n` +
      `- Defect category: ${category}\n` +
      `- Trend: reports increased ${rise}% versus the previous 30 days\n` +
      `- ${costLine}\n` +
      `- Recommended preventive action for this category: ${actionFor(category)}\n` +
      `State the block, category, and the exact ${rise}% rise; give the specific ` +
      `preventive action above (not a generic "take action"); and mention the ` +
      `projected cost. Plain language, no markdown, no preamble.`;

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.4,
    });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    return text || fallback;
  } catch {
    // UC-006 E1: never let an OpenAI failure break the analysis run.
    return fallback;
  }
}

/**
 * Deterministic, professional fallback executive summary for the monthly report
 * (UC-009). Used when OPENAI_API_KEY is unset or the API errors, so a report can
 * always be generated. Data-driven and detailed: covers volume, the leading
 * category/block, SLA compliance, average rectification, the cost outlook
 * (actual + AI-projected), and one or two concrete recommendations.
 *
 * @param {import('../models/reportModel').ReportData} reportData
 * @returns {string} a multi-sentence summary paragraph.
 */
function fallbackSummary(reportData) {
  const total = reportData.totalDefects;
  const slaPct = reportData.sla.compliancePct;
  const topCategory = reportData.byCategory[0]?.category || 'general';
  const topBlock = reportData.byBlock[0]?.block;
  const avgDays = reportData.avgRectification.days;
  const { actual, estimated, projected } = reportData.costs;
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

  const avgPart =
    avgDays == null
      ? 'No defects were rectified in this period, so no rectification time is available.'
      : `Closed defects were rectified in an average of ${avgDays} day(s).`;
  const blockPart = topBlock ? `, most concentrated in Block ${topBlock}` : '';
  const costPart =
    `Recorded spend on closed work totalled ${money(actual)}, and AI risk alerts ` +
    `project a further ${money(estimated)} in likely costs — a total exposure of ${money(projected)}.`;
  // Recommendation keys off SLA health, then the leading defect category/block.
  const recommendation =
    slaPct < 80
      ? `Recommendation: prioritise ${topCategory} defects${topBlock ? ` in Block ${topBlock}` : ''} and tighten contractor turnaround to lift SLA compliance above the 80% target.`
      : `Recommendation: sustain the current turnaround while monitoring recurring ${topCategory} defects for early preventive action.`;

  return (
    `During this reporting period, ${total} defect(s) were logged across the estate, ` +
    `achieving ${slaPct}% SLA compliance. ${avgPart} ` +
    `The leading defect category was ${topCategory}${blockPart}. ` +
    `${costPart} ${recommendation}`
  );
}

/**
 * Generate a detailed executive summary plus recommendation(s) for the monthly
 * estate report. Sends the aggregated {@link ReportData} to OpenAI when
 * OPENAI_API_KEY is configured; otherwise (or on any API error) returns the
 * deterministic {@link fallbackSummary}. Never throws.
 *
 * @param {import('../models/reportModel').ReportData} reportData - aggregated metrics.
 * @returns {Promise<string>} the executive summary text.
 */
async function generateExecutiveSummary(reportData) {
  const fallback = fallbackSummary(reportData);
  if (!config.OPENAI_API_KEY) {
    return fallback;
  }

  try {
    // Lazy require so the no-key path stays dependency-free (see generateRiskAlert).
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

    const facts =
      `- Reporting period: ${reportData.period.startDate} to ${reportData.period.endDate}\n` +
      `- Total defects: ${reportData.totalDefects}\n` +
      `- SLA compliance: ${reportData.sla.compliancePct}% ` +
      `(${reportData.sla.compliant}/${reportData.sla.eligible} within deadline)\n` +
      `- Average rectification: ${reportData.avgRectification.days ?? 'n/a'} day(s)\n` +
      `- Defects by category: ${
        reportData.byCategory.map((c) => `${c.category} (${c.count})`).join(', ') || 'none'
      }\n` +
      `- Top recurring defects: ${
        reportData.topRecurringDefects
          .map((r) => `${r.category} in Block ${r.block} (${r.count})`)
          .join(', ') || 'none'
      }\n` +
      `- Defects by block: ${
        reportData.byBlock.map((b) => `Block ${b.block} (${b.count})`).join(', ') || 'none'
      }\n` +
      `- Costs: actual spend on closed work $${reportData.costs.actual}, ` +
      `AI-projected open costs $${reportData.costs.estimated}, ` +
      `total exposure $${reportData.costs.projected}`;

    const prompt =
      `You are writing the executive summary of a monthly estate maintenance ` +
      `report for a property manager. Using only these facts:\n${facts}\n\n` +
      `Write a detailed yet readable executive summary of 130-170 words in ` +
      `flowing prose (no bullet points, no markdown, no preamble). Cover: the ` +
      `overall defect volume and how it breaks down by category and block; SLA ` +
      `compliance and average rectification time, and what they say about ` +
      `performance; the cost picture (actual spend plus AI-projected costs and ` +
      `total exposure); and the most notable recurring risks. End with one or ` +
      `two clear, actionable recommendations.`;

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.4,
    });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    return text || fallback;
  } catch {
    // Graceful degradation: a report must always have a summary.
    return fallback;
  }
}

/**
 * Extract a completed spot-check form from a photographed image via OpenAI
 * vision (UC-013). `itemTexts` is the live checklist template's item text, in
 * `display_order` — the prompt is built from this, not a hardcoded copy of
 * the 25 items, so a future checklist change needs no code change here. The
 * response is positional: one result per input item, in the same order, so
 * the caller (inspectionController, M.3) maps position -> real
 * checklist_item_id itself rather than trusting the model to echo an id back.
 *
 * Severity and photos are never asked for or returned (M.6 — the client
 * requires the inspector to deliberately tag those, not have them guessed).
 *
 * Unlike generateRiskAlert/generateExecutiveSummary, there is no sensible
 * deterministic fallback for reading a photographed form — this throws on
 * any failure (no key, API error, malformed response) so the caller can
 * surface `422 OCR_UNREADABLE` (UC-013 Alt Flow A1) rather than silently
 * fabricating form content.
 *
 * @param {string} imageUrl - Cloudinary URL of the photographed form.
 * @param {string[]} itemTexts - checklist item text, in display_order.
 * @returns {Promise<{
 *   serviced_at: string|null,
 *   serviced_at_confidence: number,
 *   form_lift_code: string|null,
 *   items: Array<{ result: 'Pass'|'Defect'|'unreadable', remark: string|null, field_confidence: number }>
 * }>}
 * @throws {Error} when OPENAI_API_KEY is unset, the API call fails, or the
 *   response isn't valid, well-formed JSON matching the expected shape. Errors
 *   from a down/misconfigured service (as opposed to a bad photo) carry
 *   `err.serviceUnavailable = true` (UC-013 A4), so the controller can tell
 *   them apart from A1's "unreadable image".
 */
async function extractSpotCheckForm(imageUrl, itemTexts) {
  if (!config.OPENAI_API_KEY) {
    const err = new Error('OCR prefill unavailable: OPENAI_API_KEY is not configured.');
    err.serviceUnavailable = true;
    throw err;
  }

  // Lazy require so the no-key path (checked above) stays dependency-free,
  // matching generateRiskAlert/generateExecutiveSummary.
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const numberedItems = itemTexts.map((text, i) => `${i + 1}. ${text}`).join('\n');
  const prompt =
    `This image is a completed, handwritten lift spot-check form. It has a ` +
    `"Servicing Date" field, a lift/block identifier in the header, and a ` +
    `checklist of ${itemTexts.length} numbered items, each ticked Pass (✓) or ` +
    `marked Defect (✗/X) in its own check column. A written remark next to a row ` +
    `is optional and uncommon — most rows, including most Defect rows, have no ` +
    `remark at all.\n\n` +
    `The checklist items, in order, are:\n${numberedItems}\n\n` +
    `Read the form and return strict JSON, and nothing else, in exactly this shape:\n` +
    `{\n` +
    `  "serviced_at": "YYYY-MM-DD" or null if unreadable,\n` +
    `  "serviced_at_confidence": a number from 0 to 1,\n` +
    `  "form_lift_code": the lift or block code written in the header, or null if not visible,\n` +
    `  "items": [\n` +
    `    { "item_number": the number (1-${itemTexts.length}) of the numbered item this row answers, "result": "Pass" | "Defect" | "unreadable", "remark": string or null, "field_confidence": a number from 0 to 1 }\n` +
    `    ... exactly ${itemTexts.length} entries, one per numbered item above, in the same order\n` +
    `  ]\n` +
    `}\n\n` +
    `Base "result" ONLY on that row's own check-column mark, not on whether there's handwriting ` +
    `nearby — a remark elsewhere on the page belongs to whichever row it's actually written next ` +
    `to, not to every Defect row.\n` +
    `For "remark": read only literal handwritten text actually written next to that specific row. ` +
    `null is the correct, expected answer whenever no such text exists — that is the normal case, ` +
    `not a failure. Never restate, paraphrase, or reuse the numbered question text (or any part of ` +
    `it) as the remark; a remark that just repeats the question is always wrong and must be null ` +
    `instead.\n` +
    `Never guess a severity or invent a remark that isn't legible — mark a row "unreadable" and ` +
    `use a low field_confidence instead of forcing a Pass/Defect you aren't confident about. ` +
    `The "items" array MUST contain EXACTLY ${itemTexts.length} entries, no more and no fewer — ` +
    `one per numbered item above. Never split a single numbered item (even one with two ` +
    `questions, like "Functioning? Replacement date?") into two entries, and never add an entry ` +
    `for anything not in the numbered list (e.g. the header fields or servicing date, which are ` +
    `already asked for separately above). Every entry's "item_number" must be the number of the ` +
    `specific numbered item above that it answers, and every number from 1 to ${itemTexts.length} ` +
    `must appear exactly once.`;

  // Vision output for a dense 25-item form occasionally comes back malformed
  // (truncated/invalid JSON, or the wrong item count) even at temperature 0 —
  // confirmed by re-scanning the exact same photo and getting 26 items back on
  // a retry. Automatic retries clear most of these transient misreads without
  // forcing the inspector to rescan by hand; each retry after the first tells
  // the model what went wrong last time, since a bare re-ask tends to repeat
  // the same mistake. A real outage (serviceUnavailable) is not retried — it
  // won't succeed on a second try.
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptPrompt =
      attempt === 1
        ? prompt
        : `${prompt}\n\nYour previous attempt was rejected: ${lastErr.message} Re-read the ` +
          `form carefully and return exactly ${itemTexts.length} entries this time — do not ` +
          `split any item into two, and give every entry the correct "item_number".`;
    try {
      return await requestAndParseForm(client, attemptPrompt, imageUrl, itemTexts);
    } catch (err) {
      if (err.serviceUnavailable) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

// Single attempt: call the vision model and parse/validate its response.
// Throws on any failure — the caller (extractSpotCheckForm) decides whether
// to retry.
async function requestAndParseForm(client, prompt, imageUrl, itemTexts) {
  let resp;
  try {
    resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      // 2000 was tight for a 25-item response (per-item result + remark +
      // confidence) and risked truncating mid-JSON on a dense form, which
      // surfaces as a confusing "not valid JSON" / OCR_UNREADABLE rather than
      // the real cause. More headroom costs little and avoids that failure
      // mode outright.
      max_tokens: 3500,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    // The API call itself failing (network, rate limit, quota) means the
    // service is unavailable, not that the photo was bad.
    err.serviceUnavailable = true;
    throw err;
  }

  const text = resp?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned no content for the form scan.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('OpenAI response was not valid JSON.');
  }

  if (!Array.isArray(parsed.items)) {
    throw new Error(`OpenAI response has 0 items, expected ${itemTexts.length}.`);
  }

  let items = parsed.items;
  if (items.length !== itemTexts.length) {
    // A wrong count is usually one item wrongly split in two — item_number
    // says which numbered item each entry actually answers, so the right
    // answer for every expected item can often be recovered without
    // discarding the whole scan. Only safe when every number 1..N is
    // actually covered; otherwise there's a genuine gap and the caller
    // should retry instead of guessing.
    const reconciled = reconcileByItemNumber(items, itemTexts.length);
    if (!reconciled) {
      throw new Error(`OpenAI response has ${items.length} items, expected ${itemTexts.length}.`);
    }
    items = reconciled;
  }

  const RESULTS = ['Pass', 'Defect', 'unreadable'];
  return {
    serviced_at: typeof parsed.serviced_at === 'string' ? parsed.serviced_at : null,
    serviced_at_confidence:
      typeof parsed.serviced_at_confidence === 'number' ? parsed.serviced_at_confidence : 0,
    form_lift_code: typeof parsed.form_lift_code === 'string' ? parsed.form_lift_code : null,
    items: items.map((entry) => ({
      result: RESULTS.includes(entry?.result) ? entry.result : 'unreadable',
      remark: typeof entry?.remark === 'string' ? entry.remark : null,
      field_confidence: typeof entry?.field_confidence === 'number' ? entry.field_confidence : 0,
    })),
  };
}

// Keeps the first entry claiming each item_number; returns null unless every
// number from 1 to expectedCount is covered by exactly one such entry.
function reconcileByItemNumber(items, expectedCount) {
  const byNumber = new Map();
  for (const entry of items) {
    const n = entry?.item_number;
    if (Number.isInteger(n) && n >= 1 && n <= expectedCount && !byNumber.has(n)) {
      byNumber.set(n, entry);
    }
  }
  if (byNumber.size !== expectedCount) return null;
  return Array.from({ length: expectedCount }, (_, i) => byNumber.get(i + 1));
}

// Display names the prompt uses — kept out of the public language codes so a
// caller can't smuggle arbitrary text into the prompt through `targetLanguage`.
const LANGUAGE_NAMES = {
  en: 'English',
  zh: 'Mandarin Chinese',
  ms: 'Malay',
  ta: 'Tamil',
};

/**
 * Translate a report's title/description for a reader whose preferred
 * language differs from whatever the resident wrote it in.
 *
 * Unlike generateRiskAlert/generateExecutiveSummary there is no sensible
 * deterministic fallback for translating someone else's words — this throws
 * on any failure (no key, API error, malformed response) so the caller can
 * tell "translated" apart from "translation unavailable right now" rather
 * than silently showing invented text.
 *
 * @param {{title: string, description: string}} text
 * @param {'en'|'zh'|'ms'|'ta'} targetLanguage
 * @returns {Promise<{title: string, description: string, was_translated: boolean}>}
 *   was_translated is false when the text was already in targetLanguage —
 *   the model is asked to say so rather than the caller diffing strings,
 *   since only it actually knows whether a match is coincidence (a title
 *   that's just a block number reads the same in every language).
 * @throws {Error} when OPENAI_API_KEY is unset, the API call fails, or the
 *   response isn't valid JSON in the expected shape.
 */
async function translateInspectionText({ title, description }, targetLanguage) {
  const languageName = LANGUAGE_NAMES[targetLanguage];
  if (!languageName) {
    throw new Error(`Unsupported target language: ${targetLanguage}`);
  }
  if (!config.OPENAI_API_KEY) {
    const err = new Error('Translation unavailable: OPENAI_API_KEY is not configured.');
    err.serviceUnavailable = true;
    throw err;
  }

  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const prompt =
    `Translate the following estate-defect report into ${languageName}. Detect ` +
    `the source language yourself — do not assume it.\n\n` +
    `Title: ${title}\n` +
    `Description: ${description || '(none given)'}\n\n` +
    `Return strict JSON, and nothing else, in exactly this shape:\n` +
    `{\n` +
    `  "title": the title translated into ${languageName},\n` +
    `  "description": the description translated into ${languageName} (empty string if none was given),\n` +
    `  "was_translated": true, unless the source text was already written in ${languageName},` +
    ` in which case false and return the text unchanged\n` +
    `}\n` +
    `Preserve technical terms, unit/block numbers, and names as-is. Do not add ` +
    `commentary, quotation marks, or explanation — only the JSON object.`;

  let resp;
  try {
    resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    // The API call itself failing (network, rate limit, quota) means the
    // service is unavailable, not that the text was untranslatable.
    err.serviceUnavailable = true;
    throw err;
  }

  const text = resp?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned no content for the translation.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('OpenAI response was not valid JSON.');
  }
  if (typeof parsed.title !== 'string') {
    throw new Error('OpenAI response is missing a translated title.');
  }

  return {
    title: parsed.title,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    was_translated: parsed.was_translated !== false,
  };
}

/**
 * Translate the free text OTHER people wrote on a resident's own report —
 * the manager's closing remark, inspector/contractor checklist remarks, and
 * audit-history notes (MyReportsPage) — for a resident reading it in their
 * own preferred_language. Not the resident's own title/description; they
 * wrote those themselves already (see translateInspectionText for that half).
 *
 * One call for everything on the card, cached together (inspectionModel's
 * saveTranslation extras columns) rather than one call per remark — a report
 * with a closing remark plus a dozen checklist items would otherwise be a
 * dozen+ OpenAI calls for a single page view.
 *
 * @param {{
 *   closing_remark: string|null,
 *   checklist_results: {id: string, remark: string|null}[],
 *   history: {id: string, note: string|null}[],
 * }} extras
 * @param {'en'|'zh'|'ms'|'ta'} targetLanguage
 * @returns {Promise<{
 *   closing_remark: string|null,
 *   checklist_remarks: {id: string, remark: string}[],
 *   history_notes: {id: string, note: string}[],
 *   was_translated: boolean,
 * }>}
 * @throws {Error} when OPENAI_API_KEY is unset, the API call fails, or the
 *   response isn't valid JSON in the expected shape.
 */
async function translateReportExtras({ closing_remark, checklist_results = [], history = [] }, targetLanguage) {
  const languageName = LANGUAGE_NAMES[targetLanguage];
  if (!languageName) {
    throw new Error(`Unsupported target language: ${targetLanguage}`);
  }

  // Only items that actually carry text are worth a round trip — most
  // checklist rows and history entries have no remark/note at all. remark
  // only, not completion_remark — ReportCard.jsx never renders that field.
  const checklistItems = checklist_results
    .filter((r) => r.remark)
    .map((r) => ({ id: r.id, remark: r.remark }));
  const historyItems = history
    .filter((h) => h.note)
    .map((h) => ({ id: h.id, note: h.note }));

  // Nothing to translate — a report with no remarks yet needs no API call.
  if (!closing_remark && checklistItems.length === 0 && historyItems.length === 0) {
    return { closing_remark: null, checklist_remarks: [], history_notes: [], was_translated: false };
  }

  if (!config.OPENAI_API_KEY) {
    const err = new Error('Translation unavailable: OPENAI_API_KEY is not configured.');
    err.serviceUnavailable = true;
    throw err;
  }

  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const prompt =
    `Translate the following notes from an estate-defect report into ` +
    `${languageName}, for the resident who filed it. Detect the source ` +
    `language of each yourself — do not assume it. Every "id" below must be ` +
    `echoed back exactly as given; only the text fields change.\n\n` +
    `Closing remark (how a manager resolved it, or null if not yet closed): ` +
    `${JSON.stringify(closing_remark ?? null)}\n\n` +
    `Checklist remarks:\n${JSON.stringify(checklistItems)}\n\n` +
    `History notes:\n${JSON.stringify(historyItems)}\n\n` +
    `Return strict JSON, and nothing else, in exactly this shape:\n` +
    `{\n` +
    `  "closing_remark": the closing remark translated into ${languageName}, or null if it was null,\n` +
    `  "checklist_remarks": [{"id": ..., "remark": ...}, ...] translated, same ids and order,\n` +
    `  "history_notes": [{"id": ..., "note": ...}, ...] translated, same ids and order,\n` +
    `  "was_translated": true, unless all of the given text was already written in ${languageName},` +
    ` in which case false and return every text field unchanged\n` +
    `}\n` +
    `Preserve technical terms, unit/block numbers, and names as-is. Do not add ` +
    `commentary, quotation marks, or explanation — only the JSON object.`;

  let resp;
  try {
    resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    err.serviceUnavailable = true;
    throw err;
  }

  const text = resp?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned no content for the translation.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('OpenAI response was not valid JSON.');
  }

  return {
    closing_remark: typeof parsed.closing_remark === 'string' ? parsed.closing_remark : null,
    checklist_remarks: Array.isArray(parsed.checklist_remarks) ? parsed.checklist_remarks : [],
    history_notes: Array.isArray(parsed.history_notes) ? parsed.history_notes : [],
    was_translated: parsed.was_translated !== false,
  };
}

module.exports = {
  categoriseIncident,
  generateRiskAlert,
  generateExecutiveSummary,
  fallbackSummary,
  extractSpotCheckForm,
  translateInspectionText,
  translateReportExtras,
};
