// Minimal trend line — no axes/legend/points, just the squiggle — for a KPI
// tile. `data` is a plain array of numbers (already bucketed by the caller
// from real timestamps); this component only renders it.
import { Box } from '@mui/material';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { alpha, useTheme } from '@mui/material/styles';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler);

// `color` is a theme palette key (e.g. "error", "warning"), resolved here —
// not a raw CSS color — so every caller can keep using the same semantic
// colors as the rest of the KPI tile instead of hard-coding hex.
export default function Sparkline({ data, color, height = 48 }) {
  const theme = useTheme();
  const resolved = theme.palette[color]?.main ?? theme.palette.primary.main;

  const chartData = {
    labels: data.map((_, i) => i),
    datasets: [
      {
        data,
        borderColor: resolved,
        backgroundColor: (ctx) => {
          const { chart } = ctx;
          const { ctx: canvasCtx, chartArea } = chart;
          if (!chartArea) return alpha(resolved, 0.15);
          const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, alpha(resolved, 0.3));
          gradient.addColorStop(1, alpha(resolved, 0));
          return gradient;
        },
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    responsive: true,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: { display: false },
      y: { display: false },
    },
  };

  return (
    <Box sx={{ height, width: '100%' }}>
      <Line data={chartData} options={options} />
    </Box>
  );
}
