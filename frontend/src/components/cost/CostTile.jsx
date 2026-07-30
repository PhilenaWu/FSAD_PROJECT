// UC-011 KPI stat tile — same visual language as the UC-005 KpiRow tiles.
import { Paper, Stack, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';

export default function CostTile({ label, value, sub, trend, trendLabel }) {
  // trend: positive % = spend up vs the prior window (bad → red), negative = down (good → green)
  const TrendIcon = trend > 0 ? TrendingUpIcon : TrendingDownIcon;
  const trendColor = trend > 0 ? 'error.main' : 'success.main';

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={700}>
        {value}
      </Typography>
      {trend != null && (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: trendColor }}>
          <TrendIcon fontSize="small" />
          <Typography variant="caption" fontWeight={600}>
            {trend > 0 ? '+' : ''}
            {trend}% {trendLabel}
          </Typography>
        </Stack>
      )}
      {sub && (
        <Typography variant="caption" color="text.secondary" component="div">
          {sub}
        </Typography>
      )}
    </Paper>
  );
}
