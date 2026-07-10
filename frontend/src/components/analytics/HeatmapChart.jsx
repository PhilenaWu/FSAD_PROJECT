// UC-005 heatmap — issues by block × category (Chart.js matrix plugin).
// Cell colour intensity scales with count; clicking a cell drills down to the
// incident list filtered by that block + category (phase task 5.11).
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Chart as ChartJS, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';
import { Chart } from 'react-chartjs-2';
import { alpha, useTheme } from '@mui/material/styles';

ChartJS.register(CategoryScale, LinearScale, Tooltip, MatrixController, MatrixElement);

export default function HeatmapChart({ data }) {
  const theme = useTheme();
  const navigate = useNavigate();

  const blocks = useMemo(() => [...new Set(data.map((d) => d.block))], [data]);
  const categories = useMemo(() => [...new Set(data.map((d) => d.category))], [data]);
  const maxCount = Math.max(1, ...data.map((d) => d.count));

  const chartData = {
    datasets: [
      {
        label: 'Issues',
        data: data.map((d) => ({ x: d.block, y: d.category, v: d.count })),
        backgroundColor: (ctx) =>
          alpha(theme.palette.primary.main, 0.15 + 0.85 * (ctx.raw.v / maxCount)),
        borderColor: theme.palette.background.paper,
        borderWidth: 2,
        borderRadius: 4,
        width: ({ chart }) => (chart.chartArea?.width ?? 0) / blocks.length - 4,
        height: ({ chart }) => (chart.chartArea?.height ?? 0) / categories.length - 4,
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    onClick: (_evt, elements) => {
      if (!elements.length) return;
      const { x: block, y: category } = chartData.datasets[0].data[elements[0].index];
      navigate(`/incidents?block=${encodeURIComponent(block)}&category=${encodeURIComponent(category)}`);
    },
    onHover: (evt, elements) => {
      evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => `Block ${items[0].raw.x} — ${items[0].raw.y}`,
          label: (item) => `${item.raw.v} issue${item.raw.v === 1 ? '' : 's'}`,
        },
      },
    },
    scales: {
      x: { type: 'category', labels: blocks, grid: { display: false }, title: { display: true, text: 'Block' } },
      y: { type: 'category', labels: categories, offset: true, grid: { display: false } },
    },
  };

  return <Chart type="matrix" data={chartData} options={options} />;
}
