// UC-005 SLA gauge — Chart.js doughnut with the compliance percentage in the
// centre (phase task 5.8).
// What-if preview: when a baseline is supplied the centre shows the delta
// ("76.4% → 75.4%") so the before/after effect of the import is explicit.
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

ChartJS.register(ArcElement, Tooltip);

// sla: the summary to render. baseline: the pre-import summary (null = normal).
export default function SlaGauge({ sla, baseline = null }) {
  const theme = useTheme();
  const pct = sla.sla_percentage;
  // Only show the delta when the import actually moved the number.
  const showDelta = baseline && baseline.sla_percentage !== pct;

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
      // Chart.js's Legend module is registered globally (trend chart) — keep
      // it off here or it squeezes the doughnut and misaligns the centre label.
      legend: { display: false },
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
        {showDelta ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
              {baseline.sla_percentage.toFixed(1)}%
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ color: 'warning.dark' }}>
              → {pct.toFixed(1)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              with imported rows
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="h4" fontWeight={700} color="text.primary">
              {pct.toFixed(0)}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {sla.compliant_count}/{sla.total_resolved} within {sla.sla_threshold_hrs}h
            </Typography>
          </>
        )}
      </Stack>
    </Box>
  );
}
