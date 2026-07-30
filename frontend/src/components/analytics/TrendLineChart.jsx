// UC-005 trend chart — issue counts over time (Chart.js line, X = period,
// Y = count). The axis is a category scale, so the series is bucketed and
// gap-filled first (utils/trendBuckets) — otherwise quiet stretches collapse
// and a year of daily points reads as noise rather than a trend.
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
import { bucketTrend } from '../../utils/trendBuckets';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Legend, Tooltip);

// Past this many points the per-point markers stop helping and start hiding
// the line; hover still reveals the exact value.
const MARKER_LIMIT = 60;

// data: [{ date, count }] from the database, or null to hide that series
// (the dashboard's "Imported only" preview view).
// imported: [{ date, count }] aggregated from the CSV preview, or null.
export default function TrendLineChart({ data, imported = null }) {
  const theme = useTheme();

  // Both series share one bucketed axis so their points stay comparable.
  const { labels, tooltips, series } = bucketTrend([data ?? [], imported ?? []]);
  const [dbCounts, importedCounts] = series;
  const dense = labels.length > MARKER_LIMIT;

  const datasets = [];

  if (data) {
    datasets.push({
      label: 'Existing (database)',
      data: dbCounts,
      borderColor: theme.palette.primary.main,
      backgroundColor: alpha(theme.palette.primary.main, 0.08),
      pointBackgroundColor: theme.palette.primary.main,
      pointRadius: dense ? 0 : 3,
      pointHoverRadius: 5,
      tension: 0.3,
      fill: true,
    });
  }

  if (imported) {
    datasets.push({
      label: 'Imported (preview)',
      data: importedCounts,
      borderColor: theme.palette.warning.dark,
      borderDash: [6, 4],
      pointBackgroundColor: theme.palette.warning.dark,
      pointStyle: 'rectRot',
      pointRadius: dense ? 0 : 4,
      pointHoverRadius: 6,
      tension: 0.3,
      fill: false,
    });
  }

  const options = {
    maintainAspectRatio: false,
    // Hovering anywhere on a column reads that period, which matters once the
    // markers are hidden on a dense axis.
    interaction: { mode: 'index', intersect: false },
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
      tooltip: {
        callbacks: {
          // Names the period, so a weekly or monthly point is never mistaken
          // for a single day's count.
          title: (items) => tooltips[items[0].dataIndex] ?? '',
        },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: {
        grid: { display: false },
        ticks: { autoSkip: true, maxTicksLimit: 13, maxRotation: 0 },
      },
    },
  };

  return <Line data={{ labels, datasets }} options={options} />;
}
