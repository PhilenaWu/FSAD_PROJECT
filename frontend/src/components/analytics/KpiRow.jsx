// UC-005 KPI summary row — four stat tiles above the charts. The "new
// reports" tile carries the movement vs the prior 30 days so the dashboard
// leads with what changed, not just what is.
// Only "Reports filed" gets a sparkline: it's the one tile backed by a real
// daily time series (the same `trends` data the chart below plots). Open
// records / avg resolution / overdue jobs are point-in-time snapshots with no
// historical series available on this page, so they stay without one rather
// than faking a trend line.
import { Box, Grid2 as Grid, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import AnimatedNumber from '../common/AnimatedNumber';
import Sparkline from '../common/Sparkline';

function Tile({ label, value, sub, trend, icon: Icon, iconColor, sparkline }) {
  // trend: positive % = more new reports (bad → red), negative = fewer (good →
  // green), exactly 0 = flat and neutral — a green down-arrow on "0%" would
  // claim an improvement that didn't happen.
  const TrendIcon = trend > 0 ? TrendingUpIcon : trend < 0 ? TrendingDownIcon : TrendingFlatIcon;
  const trendColor = trend > 0 ? 'error.main' : trend < 0 ? 'success.main' : 'text.secondary';

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {Icon && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: '50%',
              flexShrink: 0,
              color: iconColor ? `${iconColor}.main` : 'primary.main',
              bgcolor: (t) => alpha(t.palette[iconColor]?.main ?? t.palette.primary.main, 0.12),
            }}
          >
            <Icon fontSize="small" />
          </Box>
        )}
      </Stack>
      <Typography variant="h4" fontWeight={700}>
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </Typography>
      {trend != null && (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: trendColor, mt: 0.5 }}>
          <TrendIcon fontSize="small" />
          <Typography variant="caption" fontWeight={600}>
            {trend === 0 ? 'no change' : `${trend > 0 ? '+' : ''}${trend}%`} vs prior 30 days
          </Typography>
        </Stack>
      )}
      {sub && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: trend != null ? 0.25 : 0.5 }}>
          {sub}
        </Typography>
      )}
      {sparkline && <Sparkline data={sparkline} color={iconColor} height={40} />}
    </Paper>
  );
}

// `trendSparkline`: last ~14 days of { count } from the same daily series the
// trend chart plots (DashboardPage's `trends` state) — optional, so the tile
// still renders fine before it's loaded.
export default function KpiRow({ summary, trendSparkline }) {
  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid size={{ xs: 6, md: 3 }}>
        <Tile
          label="Reports filed (30 days)"
          value={summary.new_last_30}
          trend={summary.new_records_change_pct}
          sub={
            summary.new_records_change_pct == null
              ? 'no prior-period data'
              : 'all submissions, incl. since-resolved'
          }
          icon={DescriptionOutlinedIcon}
          iconColor="info"
          sparkline={trendSparkline}
        />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <Tile
          label="Open records"
          value={summary.open_count}
          sub="not yet resolved or closed"
          icon={FolderOpenOutlinedIcon}
          iconColor="secondary"
        />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <Tile
          label="Avg resolution"
          value={summary.avg_resolution_hours != null ? `${summary.avg_resolution_hours}h` : '—'}
          sub={`SLA ${summary.sla_percentage}% within ${summary.sla_threshold_hrs}h`}
          icon={AccessTimeOutlinedIcon}
          iconColor="success"
        />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <Tile
          label="Overdue jobs"
          value={summary.overdue_count}
          sub="past contractor deadline"
          icon={WarningAmberOutlinedIcon}
          iconColor="error"
        />
      </Grid>
    </Grid>
  );
}
