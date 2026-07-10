// UC-005 trend chart — daily issue counts (Chart.js line, X = date, Y = count).
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { alpha, useTheme } from '@mui/material/styles';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

export default function TrendLineChart({ data }) {
  const theme = useTheme();

  const chartData = {
    labels: data.map((d) => d.date.slice(5)), // "MM-DD"
    datasets: [
      {
        label: 'Issues reported',
        data: data.map((d) => d.count),
        borderColor: theme.palette.primary.main,
        backgroundColor: alpha(theme.palette.primary.main, 0.08),
        pointBackgroundColor: theme.palette.primary.main,
        pointRadius: 3,
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: { grid: { display: false } },
    },
  };

  return <Line data={chartData} options={options} />;
}
