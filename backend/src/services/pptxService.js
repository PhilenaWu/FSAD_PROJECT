// PowerPoint export (UC-005 task 5.13b, HLD §6.11). Renders the dashboard
// data into a deck with native (editable) PowerPoint charts via PptxGenJS.
'use strict';

const PptxGenJS = require('pptxgenjs');

const BRAND = 'CF3225'; // theme primary (no # in pptx colors)

// views: subset of ['heatmap','trends','sla_gauge','contractor_scorecard'].
// data:  { heatmap, trends, sla, scorecard } from analyticsController fetchers.
// Resolves with a Buffer of the .pptx file.
async function buildDashboardDeck(views, filters, data) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 10, height: 5.63 });
  pptx.layout = 'WIDE';

  // Title slide — states the active filters so the deck is self-describing.
  const title = pptx.addSlide();
  title.addText('EM Services — Estate Analytics', {
    x: 0.5, y: 1.6, w: 9, fontSize: 30, bold: true, color: '2E2E20',
  });
  const filterText =
    Object.entries(filters || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('   ·   ') || 'All records';
  title.addText(filterText, { x: 0.5, y: 2.5, w: 9, fontSize: 14, color: '888888' });
  title.addText(`Generated ${new Date().toISOString().slice(0, 10)}`, {
    x: 0.5, y: 3.0, w: 9, fontSize: 12, color: '888888',
  });

  if (views.includes('heatmap') && data.heatmap?.length) {
    const slide = pptx.addSlide();
    slide.addText('Issues by block × category', { x: 0.5, y: 0.25, fontSize: 18, bold: true });
    const categories = [...new Set(data.heatmap.map((r) => r.category))];
    const blocks = [...new Set(data.heatmap.map((r) => r.block))];
    // One series per block, clustered by category.
    slide.addChart(
      pptx.ChartType.bar,
      blocks.map((b) => ({
        name: `Block ${b}`,
        labels: categories,
        values: categories.map(
          (c) => data.heatmap.find((r) => r.block === b && r.category === c)?.count ?? 0
        ),
      })),
      { x: 0.5, y: 0.8, w: 9, h: 4.4, barDir: 'col', showLegend: true, legendPos: 'b' }
    );
  }

  if (views.includes('trends') && data.trends?.length) {
    const slide = pptx.addSlide();
    slide.addText('Issue trend', { x: 0.5, y: 0.25, fontSize: 18, bold: true });
    slide.addChart(
      pptx.ChartType.line,
      [{
        name: 'Issues reported',
        labels: data.trends.map((r) => r.date),
        values: data.trends.map((r) => r.count),
      }],
      { x: 0.5, y: 0.8, w: 9, h: 4.4, lineSize: 2, chartColors: [BRAND] }
    );
  }

  if (views.includes('sla_gauge') && data.sla) {
    const slide = pptx.addSlide();
    slide.addText(
      `SLA compliance — ${data.sla.sla_percentage}% within ${data.sla.sla_threshold_hrs}h`,
      { x: 0.5, y: 0.25, fontSize: 18, bold: true }
    );
    slide.addChart(
      pptx.ChartType.doughnut,
      [{
        name: 'SLA',
        labels: ['Within SLA', 'Breached'],
        values: [
          data.sla.compliant_count,
          data.sla.total_resolved - data.sla.compliant_count,
        ],
      }],
      { x: 2.75, y: 0.9, w: 4.5, h: 4.2, showPercent: true, chartColors: [BRAND, 'E8D5D2'] }
    );
  }

  if (views.includes('contractor_scorecard') && data.scorecard?.length) {
    const slide = pptx.addSlide();
    slide.addText('Contractor scorecard', { x: 0.5, y: 0.25, fontSize: 18, bold: true });
    slide.addTable(
      [
        [
          { text: 'Contractor', options: { bold: true } },
          { text: 'Jobs', options: { bold: true } },
          { text: 'Avg rectification (days)', options: { bold: true } },
          { text: 'Repeat-defect rate', options: { bold: true } },
          { text: 'Overdue', options: { bold: true } },
        ],
        ...data.scorecard.map((r) => [
          r.contractor,
          String(r.jobs),
          r.avg_rectification_days == null ? '—' : String(r.avg_rectification_days),
          `${r.repeat_defect_rate}%`,
          String(r.overdue_count),
        ]),
      ],
      { x: 0.5, y: 0.9, w: 9, fontSize: 12, border: { pt: 0.5, color: 'DDDDDD' } }
    );
  }

  return pptx.write('nodebuffer');
}

// ---------------------------------------------------------------------------
// UC-011 admin cost deck (task 5.19c)
// ---------------------------------------------------------------------------

const INK = '2E2E20';
const MUTED = '888888';
const PROJECTED_COLOR = 'E8D5D2'; // the muted counterpart to BRAND, as UC-005 uses

// Chart axes get unreadable past ~10 bars; rows arrive sorted by actual spend
// DESC, so slicing keeps the material ones and the caption reports the rest.
const CHART_ROW_CAP = 10;
const TOP_CONTRACTORS = 5;

const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Null variance means there was no actual spend to compare against — show a
// dash rather than a fabricated 0%.
const varianceLabel = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

// Human-readable window for the title slide. ISO dates are kept verbatim so the
// deck echoes exactly what the admin typed into the filter.
function dateRangeLabel({ startDate, endDate } = {}) {
  if (startDate && endDate) return `${startDate} to ${endDate}`;
  if (startDate) return `${startDate} onwards`;
  if (endDate) return `Up to ${endDate}`;
  return 'All dates';
}

// The non-date filters, for the title slide's provenance line.
function activeFilterLabel({ block, liftId, contractorId } = {}) {
  const parts = [];
  if (block) parts.push(`Block ${block}`);
  if (liftId) parts.push(`Lift ${liftId}`);
  if (contractorId) parts.push(`Contractor ${contractorId}`);
  return parts.length ? parts.join('   ·   ') : 'All blocks, lifts and contractors';
}

// Slide header used on slides 2-5.
function addHeading(slide, text) {
  slide.addText(text, { x: 0.5, y: 0.25, w: 9, fontSize: 18, bold: true, color: INK });
}

// Actual-vs-projected clustered bar chart for one dimension. `rows` are
// [{ [key], actual, projected }] already sorted by actual DESC.
function addCostChart(slide, rows, key, { projectionsSuppressed }) {
  if (!rows.length) {
    slide.addText('No cost data for the selected filters.', {
      x: 0.5, y: 2.4, w: 9, fontSize: 14, color: MUTED, align: 'center',
    });
    return;
  }

  const shown = rows.slice(0, CHART_ROW_CAP);
  const labels = shown.map((r) => String(r[key]));

  slide.addChart(
    'bar',
    [
      { name: 'Actual', labels, values: shown.map((r) => r.actual) },
      { name: 'Projected', labels, values: shown.map((r) => r.projected) },
    ],
    {
      x: 0.5, y: 0.9, w: 9, h: 4.0,
      barDir: 'col',
      showLegend: true,
      legendPos: 'b',
      chartColors: [BRAND, PROJECTED_COLOR],
    }
  );

  // Caption carries the caveats the chart itself cannot: truncation, and a
  // projected series that is structurally zero rather than genuinely nil.
  const notes = [];
  if (rows.length > shown.length) {
    notes.push(`Showing the top ${shown.length} of ${rows.length} by actual spend.`);
  }
  if (projectionsSuppressed) {
    notes.push('Projected exposure is not tracked per lift or contractor — shown as zero.');
  }
  if (notes.length) {
    slide.addText(notes.join('  '), {
      x: 0.5, y: 5.0, w: 9, fontSize: 10, color: MUTED,
    });
  }
}

// Build the admin cost deck and return the PptxGenJS instance (exported
// separately so tests can assert the deck's structure without writing a file).
//
// costData is the verbatim output of the adminController fetchers:
//   { filters, summary, byCategory, byBlock, byContractor, projections_suppressed }
function buildAdminCostDeck(costData = {}) {
  const {
    filters = {},
    summary = {},
    byCategory = [],
    byBlock = [],
    byContractor = [],
    projections_suppressed: projectionsSuppressed = false,
  } = costData;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 10, height: 5.63 });
  pptx.layout = 'WIDE';

  // --- Slide 1: title + the window and filters the numbers came from ---------
  const title = pptx.addSlide();
  title.addText('Estate Operational Cost Summary', {
    x: 0.5, y: 1.5, w: 9, fontSize: 30, bold: true, color: INK,
  });
  title.addText(dateRangeLabel(filters), {
    x: 0.5, y: 2.4, w: 9, fontSize: 16, color: BRAND,
  });
  title.addText(activeFilterLabel(filters), {
    x: 0.5, y: 2.9, w: 9, fontSize: 12, color: MUTED,
  });
  title.addText(`Generated ${new Date().toISOString().slice(0, 10)} · EM Services`, {
    x: 0.5, y: 3.4, w: 9, fontSize: 12, color: MUTED,
  });

  // --- Slide 2: the three KPI tiles ----------------------------------------
  const kpi = pptx.addSlide();
  addHeading(kpi, 'Cost summary');
  const tiles = [
    { label: 'Actual spend', value: money(summary.total_actual) },
    { label: 'Projected exposure', value: money(summary.total_projected) },
    { label: 'Variance', value: varianceLabel(summary.variance_pct) },
  ];
  tiles.forEach((tile, i) => {
    const x = 0.5 + i * 3.1;
    kpi.addText(tile.label, { x, y: 1.5, w: 2.9, fontSize: 12, color: MUTED });
    kpi.addText(tile.value, { x, y: 2.0, w: 2.9, fontSize: 26, bold: true, color: INK });
  });
  kpi.addText(
    'Actual spend is the sum of closed jobs. Projected exposure is the sum of active AI risk alerts. ' +
      'Variance is projected against actual; a dash means there was no actual spend to compare against.',
    { x: 0.5, y: 3.6, w: 9, fontSize: 10, color: MUTED }
  );

  // --- Slides 3 & 4: cost by category, then by block ------------------------
  const categorySlide = pptx.addSlide();
  addHeading(categorySlide, 'Cost by category');
  addCostChart(categorySlide, byCategory, 'category', { projectionsSuppressed });

  const blockSlide = pptx.addSlide();
  addHeading(blockSlide, 'Cost by block');
  addCostChart(blockSlide, byBlock, 'block', { projectionsSuppressed });

  // --- Slide 5: top contractors by spend -----------------------------------
  const contractorSlide = pptx.addSlide();
  addHeading(contractorSlide, `Top ${TOP_CONTRACTORS} contractors by cost`);

  if (!byContractor.length) {
    contractorSlide.addText('No contractor spend for the selected filters.', {
      x: 0.5, y: 2.4, w: 9, fontSize: 14, color: MUTED, align: 'center',
    });
  } else {
    // Share is of the spend actually shown on this slide's source list, not of
    // the estate total — the two differ once filters are applied.
    const total = byContractor.reduce((acc, r) => acc + r.total, 0);
    const shown = byContractor.slice(0, TOP_CONTRACTORS);

    contractorSlide.addTable(
      [
        [
          { text: 'Contractor', options: { bold: true } },
          { text: 'Total cost', options: { bold: true } },
          { text: 'Jobs', options: { bold: true } },
          { text: 'Avg per job', options: { bold: true } },
          { text: 'Share', options: { bold: true } },
        ],
        ...shown.map((r) => [
          r.name,
          money(r.total),
          String(r.count),
          r.count > 0 ? money(r.total / r.count) : '—',
          total > 0 ? `${Math.round((r.total / total) * 100)}%` : '—',
        ]),
      ],
      { x: 0.5, y: 0.9, w: 9, fontSize: 12, border: { pt: 0.5, color: 'DDDDDD' } }
    );

    if (byContractor.length > shown.length) {
      contractorSlide.addText(
        `${byContractor.length - shown.length} further contractor(s) not shown; ` +
          `total across all is ${money(total)}.`,
        { x: 0.5, y: 4.9, w: 9, fontSize: 10, color: MUTED }
      );
    }
  }

  return pptx;
}

// Build the admin cost deck and resolve with a Buffer of the .pptx file.
async function generateAdminCostPptx(costData) {
  return buildAdminCostDeck(costData).write('nodebuffer');
}

module.exports = { buildDashboardDeck, buildAdminCostDeck, generateAdminCostPptx };
