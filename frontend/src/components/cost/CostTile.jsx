// UC-011 KPI stat tile — same visual language as the UC-005 KpiRow tiles.
import { Paper, Stack, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';

export default function CostTile({ label, value, sub, trend, trendLabel }) {
  // trend: positive % = spend up vs the prior window (bad → red), negative =
  // down (good → green), exactly 0 = flat and neutral — a green down-arrow on
  // "0%" would claim a saving that didn't happen.
  const TrendIcon = trend > 0 ? TrendingUpIcon : trend < 0 ? TrendingDownIcon : TrendingFlatIcon;
  const trendColor = trend > 0 ? 'error.main' : trend < 0 ? 'success.main' : 'text.secondary';

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
            {trend === 0 ? 'no change' : `${trend > 0 ? '+' : ''}${trend}%`} {trendLabel}
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
