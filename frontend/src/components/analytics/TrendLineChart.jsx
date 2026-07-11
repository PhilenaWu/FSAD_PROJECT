// UC-005 trend chart — daily issue counts (Chart.js line, X = date, Y = count).
// What-if preview: existing (database) counts stay the solid brand-red line;
// imported CSV counts render as a second dashed amber line with a legend so
// the user can see exactly which movement comes from the import.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Legend,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { alpha, useTheme } from '@mui/material/styles';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Legend, Tooltip);

// data: [{ date, count }] from the database, or null to hide that series
// (the dashboard's "Imported only" preview view).
// imported: [{ date, count }] aggregated from the CSV preview, or null.
export default function TrendLineChart({ data, imported = null }) {
  const theme = useTheme();

  // Union of dates across both series, sorted, so the lines share an axis.
  const dates = [...new Set([
    ...(data ?? []).map((d) => d.date),
    ...(imported ?? []).map((d) => d.date),
  ])].sort();

  const byDate = (rows) => {
    const map = Object.fromEntries(rows.map((r) => [r.date, r.count]));
    return dates.map((d) => map[d] ?? 0);
  };

  const datasets = [];

  if (data) {
    datasets.push({
      label: 'Existing (database)',
      data: byDate(data),
      borderColor: theme.palette.primary.main,
      backgroundColor: alpha(theme.palette.primary.main, 0.08),
      pointBackgroundColor: theme.palette.primary.main,
      pointRadius: 3,
      tension: 0.3,
      fill: true,
    });
  }

  if (imported) {
    datasets.push({
      label: 'Imported (preview)',
      data: byDate(imported),
      borderColor: theme.palette.warning.dark,
      borderDash: [6, 4],
      pointBackgroundColor: theme.palette.warning.dark,
      pointStyle: 'rectRot',
      pointRadius: 4,
      tension: 0.3,
      fill: false,
    });
  }

  const options = {
    maintainAspectRatio: false,
    plugins: {
      // Legend only matters when there are two lines to tell apart. Purely a
      // key — series isolation lives in the banner's Combined/Existing/Imported
      // switch, so legend clicks are disabled to avoid a second hidden toggle.
      legend: {
        display: datasets.length > 1,
        position: 'bottom',
        labels: { boxWidth: 24 },
        onClick: null,
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: {
        grid: { display: false },
        ticks: { callback: (v, i) => dates[i]?.slice(5) }, // "MM-DD"
      },
    },
  };

  return <Line data={{ labels: dates, datasets }} options={options} />;
}
