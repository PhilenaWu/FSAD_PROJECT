// UC-011 spend-by-category bar chart.
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Legend,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { alpha, useTheme } from '@mui/material/styles';
import { fmtMoney } from './formatMoney';

ChartJS.register(CategoryScale, LinearScale, BarElement, Legend, ChartTooltip);

// Clicking a bar drills down: the page sets that category as the active
// filter (mirrors the manager heatmap's click-to-drill-down).
export default function CategoryBarChart({ data, onBarClick, chartRef }) {
  const theme = useTheme();
  const chartData = {
    labels: data.map((d) => d.category),
    datasets: [
      {
        label: 'Actual cost',
        data: data.map((d) => d.actual_cost),
        backgroundColor: alpha(theme.palette.primary.main, 0.7),
        borderRadius: 4,
      },
    ],
  };
  const options = {
    maintainAspectRatio: false,
    onClick: (_evt, elements) => {
      if (elements.length) onBarClick?.(data[elements[0].index].category);
    },
    onHover: (evt, elements) => {
      evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) => {
            const row = data[item.dataIndex];
            return `${fmtMoney(item.raw)} across ${row.jobs} job${row.jobs === 1 ? '' : 's'}`;
          },
        },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (v) => `$${Number(v).toLocaleString()}` } },
      x: { grid: { display: false } },
    },
  };
  return <Bar ref={chartRef} data={chartData} options={options} />;
}
