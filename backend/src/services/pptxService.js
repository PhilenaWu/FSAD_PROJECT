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

module.exports = { buildDashboardDeck };
