// UC-011 monthly spend trend with its damped-trend projection.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Legend,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { alpha, useTheme } from '@mui/material/styles';
import { fmtMoney } from './formatMoney';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Legend, ChartTooltip);

// Monthly actuals as a solid line; the 3-month projection (damped-trend
// exponential smoothing on complete months) continues it as a dashed amber
// curve inside a shaded ~80% uncertainty band derived from the model's own
// historical errors.
export default function CostTrendChart({ data, forecast, chartRef }) {
  const theme = useTheme();
  const points = forecast?.points ?? [];
  const labels = [...data.map((d) => d.month), ...points.map((p) => p.month)];
  const lastActual = data[data.length - 1]?.actual_cost ?? null;

  // Nulls across the actual months (anchored on the last one), then the
  // projected series — so the dashed curve continues the solid line.
  const projectionSeries = (values) => [
    ...data.map((d, i) => (i === data.length - 1 ? lastActual : null)),
    ...values,
  ];

  const datasets = [
    {
      label: 'Actual spend',
      data: [...data.map((d) => d.actual_cost), ...points.map(() => null)],
      borderColor: theme.palette.primary.main,
      backgroundColor: alpha(theme.palette.primary.main, 0.08),
      pointBackgroundColor: theme.palette.primary.main,
      pointRadius: 3,
      tension: 0.3,
      fill: true,
    },
  ];
  if (points.length) {
    // Band edges first (hidden from legend/tooltip via the '_' prefix);
    // the upper edge fills down to the lower edge drawn just before it.
    datasets.push(
      {
        label: '_band_lower',
        data: projectionSeries(points.map((p) => p.lower)),
        borderWidth: 0,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
      },
      {
        label: '_band_upper',
        data: projectionSeries(points.map((p) => p.upper)),
        borderWidth: 0,
        pointRadius: 0,
        backgroundColor: alpha(theme.palette.warning.main, 0.15),
        tension: 0.3,
        fill: '-1',
      },
      {
        label: 'Projected (damped trend)',
        data: projectionSeries(points.map((p) => p.value)),
        borderColor: theme.palette.warning.dark,
        borderDash: [6, 4],
        pointBackgroundColor: theme.palette.warning.dark,
        pointStyle: 'rectRot',
        pointRadius: 4,
        tension: 0.3,
        fill: false,
      }
    );
  }

  const options = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: points.length > 0,
        position: 'bottom',
        labels: {
          boxWidth: 24,
          filter: (item) => !item.text.startsWith('_'),
        },
        onClick: null,
      },
      tooltip: {
        filter: (item) => !item.dataset.label.startsWith('_'),
        callbacks: {
          label: (item) => {
            const projIndex = item.dataIndex - data.length;
            if (item.dataset.label.startsWith('Projected') && projIndex >= 0) {
              const p = points[projIndex];
              return `${fmtMoney(p.value)} projected (likely ${fmtMoney(p.lower)}–${fmtMoney(p.upper)})`;
            }
            const row = data[item.dataIndex];
            return row ? `${fmtMoney(item.raw)} across ${row.jobs} job${row.jobs === 1 ? '' : 's'}` : fmtMoney(item.raw);
          },
        },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (v) => `$${Number(v).toLocaleString()}` } },
      x: { grid: { display: false } },
    },
  };
  return <Line ref={chartRef} data={{ labels, datasets }} options={options} />;
}
