// UC-005 KPI summary row — four stat tiles above the charts. The "new
// reports" tile carries the movement vs the prior 30 days so the dashboard
// leads with what changed, not just what is.
import { Grid2 as Grid, Paper, Stack, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';

function Tile({ label, value, sub, trend }) {
  // trend: positive % = more new reports (bad → red), negative = fewer (good → green)
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
            {trend}% vs prior 30 days
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

export default function KpiRow({ summary }) {
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
        />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <Tile label="Open records" value={summary.open_count} sub="not yet resolved or closed" />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <Tile
          label="Avg resolution"
          value={summary.avg_resolution_hours != null ? `${summary.avg_resolution_hours}h` : '—'}
          sub={`SLA ${summary.sla_percentage}% within ${summary.sla_threshold_hrs}h`}
        />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <Tile label="Overdue jobs" value={summary.overdue_count} sub="past contractor deadline" />
      </Grid>
    </Grid>
  );
}
