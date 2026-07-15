// AI helpers for incidents. categoriseIncident is STUBBED so UC-001 works
// without an API key. generateRiskAlert (UC-006) calls OpenAI to phrase a risk
// alert and falls back to a deterministic template when the key is missing or
// the API errors (UC-006 E1: graceful degradation).
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
  return { category: 'Uncategorised', priority_score: 50 };
}

/**
 * Deterministic fallback alert (<=60 words). Used when OpenAI is unavailable so
 * runAnalysis always produces usable card text. Names the block, category,
 * trend, a preventive action, and the projected cost impact.
 *
 * @param {string} block
 * @param {string} category
 * @param {number} velocity_pct
 * @param {number|null} estimated_cost
 * @returns {string}
 */
function fallbackAlert(block, category, velocity_pct, estimated_cost) {
  const rise = Math.round(velocity_pct);
  const cost =
    estimated_cost != null
      ? ` Projected cost impact: about $${Math.round(estimated_cost).toLocaleString()}.`
      : '';
  return (
    `${category} defects in Block ${block} are up ${rise}% versus the previous ` +
    `30 days. Schedule preventive maintenance and inspect affected units before ` +
    `failures escalate.${cost}`
  );
}

/**
 * Generate a plain-language risk alert (<=60 words) for a rising defect trend.
 * Names the lift/block, the trend, a recommended preventive action, and the
 * projected cost impact. Calls OpenAI when OPENAI_API_KEY is configured;
 * otherwise (or on any API error) returns the deterministic fallback template.
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

    const costLine =
      estimated_cost != null
        ? `Projected cost impact: about $${Math.round(estimated_cost)}.`
        : 'Cost impact unknown (no prior cost data).';

    const prompt =
      `Write a facilities risk alert in 60 words or fewer for an estate manager. ` +
      `Block: ${block}. Defect category: ${category}. Trend: reports up ` +
      `${Math.round(velocity_pct)}% versus the previous 30 days. ${costLine} ` +
      `Name the block and category, state the rising trend, recommend one ` +
      `preventive action, and mention the projected cost impact. Plain language, ` +
      `no markdown, no preamble.`;

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

module.exports = { categoriseIncident, generateRiskAlert };
