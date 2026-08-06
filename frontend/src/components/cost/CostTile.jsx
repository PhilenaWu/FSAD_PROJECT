// UC-011 KPI stat tile — same visual language as the UC-005 KpiRow tiles.
import { Box, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import AnimatedNumber from '../common/AnimatedNumber';

// `value` may be a raw number (animates, formatted via `format`) or an
// already-composed string like "—" / "+4%" (rendered as-is).
export default function CostTile({ label, value, sub, trend, trendLabel, format, icon: Icon, iconColor }) {
  // trend: positive % = spend up vs the prior window (bad → red), negative =
  // down (good → green), exactly 0 = flat and neutral — a green down-arrow on
  // "0%" would claim a saving that didn't happen.
  const TrendIcon = trend > 0 ? TrendingUpIcon : trend < 0 ? TrendingDownIcon : TrendingFlatIcon;
  const trendColor = trend > 0 ? 'error.main' : trend < 0 ? 'success.main' : 'text.secondary';

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        {Icon && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: '50%',
              flexShrink: 0,
              color: iconColor ? `${iconColor}.main` : 'primary.main',
              bgcolor: (t) => alpha(t.palette[iconColor]?.main ?? t.palette.primary.main, 0.12),
            }}
          >
            <Icon fontSize="small" />
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ color: iconColor ? `${iconColor}.main` : 'text.primary' }}
          >
            {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
          </Typography>
        </Box>
      </Stack>
      {trend != null && (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: trendColor, mt: 1 }}>
          <TrendIcon fontSize="small" />
          <Typography variant="caption" fontWeight={600}>
            {trend === 0 ? 'no change' : `${trend > 0 ? '+' : ''}${trend}%`} {trendLabel}
          </Typography>
        </Stack>
      )}
      {sub && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: trend != null ? 0 : 1 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}
