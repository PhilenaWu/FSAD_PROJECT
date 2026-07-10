// UC-005 SLA gauge — Chart.js doughnut with the compliance percentage in the
// centre (phase task 5.8).
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

ChartJS.register(ArcElement, Tooltip);

export default function SlaGauge({ sla }) {
  const theme = useTheme();
  const pct = sla.sla_percentage;

  const chartData = {
    labels: ['Within SLA', 'Breached'],
    datasets: [
      {
        data: [pct, 100 - pct],
        backgroundColor: [
          theme.palette.primary.main,
          alpha(theme.palette.primary.main, 0.12),
        ],
        borderWidth: 0,
        cutout: '75%',
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: { label: (item) => `${item.label}: ${item.raw.toFixed(1)}%` },
      },
    },
  };

  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <Doughnut data={chartData} options={options} />
      {/* Centre label overlaid on the doughnut hole */}
      <Stack
        alignItems="center"
        justifyContent="center"
        sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <Typography variant="h4" fontWeight={700} color="text.primary">
          {pct.toFixed(0)}%
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {sla.compliant_count}/{sla.total_resolved} within {sla.sla_threshold_hrs}h
        </Typography>
      </Stack>
    </Box>
  );
}
