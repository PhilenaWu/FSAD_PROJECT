// AI helpers for incidents. categoriseIncident is STUBBED so UC-001 works
// without an API key. generateRiskAlert (UC-006) calls OpenAI to phrase a risk
// alert and falls back to a deterministic, data-driven template when the key is
// missing or the API errors (UC-006 E1: graceful degradation).
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
  Other: 'conduct a targeted preventive inspection of the affected area',
  Uncategorised: 'conduct a targeted preventive inspection of the affected area',
};

/**
 * The recommended preventive action for a category (falls back to a generic
 * targeted inspection for unknown categories).
 * @param {string} category
 * @returns {string}
 */
function actionFor(category) {
  return CATEGORY_ACTIONS[category] || CATEGORY_ACTIONS.Uncategorised;
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

module.exports = {
  categoriseIncident,
  generateRiskAlert,
  generateExecutiveSummary,
  fallbackSummary,
};
