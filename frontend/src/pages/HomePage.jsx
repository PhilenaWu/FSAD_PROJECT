// Resident home page. Redesigned to match a reference mockup, but every
// number/chart here is computed from data this page already fetches
// (GET /api/inspections/my and /status-board) — no new endpoints, no invented
// metrics. Two things the mockup showed that are NOT here because they would
// require fabricating data: a live weather widget (no weather API in this
// app) and GPS pins on "Around the Estate" (no location data to plot).
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Box,
  Chip,
  Grid2 as Grid,
  InputAdornment,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Legend,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { STATUS_GROUPS, statusDisplay, statusGroup } from '../utils/statusDisplay';
import { timeAgo } from '../utils/timeAgo';
import EmptyState from '../components/common/EmptyState';
import StatTile from '../components/common/StatTile';

ChartJS.register(ArcElement, CategoryScale, LinearScale, PointElement, LineElement, Filler, Legend, ChartTooltip);

function PanelHeader({ title, action }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
      {action}
    </Stack>
  );
}

// Report counts for the last `weeks` calendar weeks, oldest first — used by
// the "Reports Trend" line chart. Bucketed client-side from the resident's
// own already-fetched reports; no new endpoint.
function buildWeeklyTrend(reports, weeks = 5) {
  const MS_DAY = 86400000;
  const now = new Date();
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * MS_DAY);
    const start = new Date(end.getTime() - 6 * MS_DAY);
    buckets.push({ start, end, count: 0 });
  }
  for (const r of reports) {
    const created = new Date(r.created_at);
    const bucket = buckets.find((b) => created >= b.start && created <= b.end);
    if (bucket) bucket.count += 1;
  }
  return buckets.map((b) => ({
    label: b.start.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' }),
    count: b.count,
  }));
}

export default function HomePage() {
  const { profile } = useAuth();
  const theme = useTheme();
  const [myReports, setMyReports] = useState([]);
  const [estate, setEstate] = useState([]);
  const [now, setNow] = useState(new Date());
  const [period, setPeriod] = useState('month'); // 'month' | 'all' — "My Reports Overview" filter
  const [search, setSearch] = useState('');

  // Both fetches are best-effort — the page renders fine with either missing.
  useEffect(() => {
    let active = true;
    api
      .get('/api/inspections/my')
      .then((res) => active && setMyReports(res.data.data))
      .catch(() => {});
    api
      .get('/api/inspections/status-board')
      .then((res) => active && setEstate(res.data.data))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Live clock for the date/time widget — no weather API in this app, so that
  // half of the reference mockup's widget is intentionally left out.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const reportsInPeriod = useMemo(() => {
    if (period === 'all') return myReports;
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return myReports.filter((r) => new Date(r.created_at) >= start);
  }, [myReports, period, now]);

  const counts = useMemo(() => {
    const c = { review: 0, progress: 0, done: 0 };
    for (const r of myReports) c[statusGroup(r.status)] += 1;
    return c;
  }, [myReports]);

  const periodCounts = useMemo(() => {
    const c = { review: 0, progress: 0, done: 0 };
    for (const r of reportsInPeriod) c[statusGroup(r.status)] += 1;
    return c;
  }, [reportsInPeriod]);

  // Average resolution time in days, from the caller's own closed reports
  // that carry a resolution_time_hours value. '—' when none do yet.
  const avgResolutionDays = useMemo(() => {
    const resolved = myReports.filter((r) => r.resolution_time_hours != null);
    if (resolved.length === 0) return null;
    const avgHours = resolved.reduce((sum, r) => sum + Number(r.resolution_time_hours), 0) / resolved.length;
    return (avgHours / 24).toFixed(1);
  }, [myReports]);

  const trend = useMemo(() => buildWeeklyTrend(myReports), [myReports]);

  // Estate-wide status breakdown (all fetched records, not just the latest 3)
  // for the "Around the Estate" panel.
  const estateCounts = useMemo(() => {
    const c = { review: 0, progress: 0, done: 0 };
    for (const r of estate) c[statusGroup(r.status)] += 1;
    return c;
  }, [estate]);

  const recentReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? myReports.filter(
          (r) =>
            r.title?.toLowerCase().includes(q) ||
            r.location_block?.toLowerCase().includes(q) ||
            r.category?.toLowerCase().includes(q) ||
            statusDisplay(r.status).label.toLowerCase().includes(q)
        )
      : myReports;
    return q ? filtered : filtered.slice(0, 5);
  }, [myReports, search]);

  const donutTotal = periodCounts.review + periodCounts.progress + periodCounts.done;

  const donutData = {
    labels: [STATUS_GROUPS.review.label, STATUS_GROUPS.progress.label, STATUS_GROUPS.done.label],
    datasets: [
      {
        data: [periodCounts.review, periodCounts.progress, periodCounts.done],
        backgroundColor: [
          theme.palette.error.main,
          theme.palette.warning.main,
          theme.palette.success.main,
        ],
        borderWidth: 0,
      },
    ],
  };

  const trendData = {
    labels: trend.map((t) => t.label),
    datasets: [
      {
        data: trend.map((t) => t.count),
        borderColor: theme.palette.primary.main,
        backgroundColor: alpha(theme.palette.primary.main, 0.1),
        pointBackgroundColor: theme.palette.primary.main,
        pointRadius: 3,
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const fullName = profile?.full_name ?? 'there';
  const firstName = fullName.split(' ')[0];

  const QUICK_ACTIONS = [
    { label: 'Report a new issue', caption: 'Let us know about a defect', to: '/report', icon: AddCircleOutlineIcon, color: 'primary' },
    { label: 'View all my reports', caption: 'Track your submitted reports', to: '/my-reports', icon: AssignmentOutlinedIcon, color: 'info' },
    { label: 'Estate status board', caption: "See what's happening around you", to: '/status-board', icon: GridViewOutlinedIcon, color: 'secondary' },
    { label: 'Emergency contacts', caption: 'Important phone numbers', to: '/emergency-contacts', icon: LocalPhoneOutlinedIcon, color: 'error' },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      {/* Header: greeting + live date/time */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Hi {firstName} 👋
          </Typography>
          {profile?.block_number && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
              <ApartmentOutlinedIcon fontSize="inherit" />
              <Typography variant="body2">
                Block {profile.block_number}
                {profile.unit_number ? ` · #${profile.unit_number}` : ''}
              </Typography>
            </Stack>
          )}
        </Box>
        <Paper variant="outlined" sx={{ px: 2.5, py: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <AccessTimeOutlinedIcon fontSize="small" color="action" />
          <Box>
            <Typography variant="body2" fontWeight={700}>
              {now.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
            </Typography>
          </Box>
        </Paper>
      </Stack>

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <StatTile label="My Reports" value={myReports.length} sub="Total submitted" icon={AssignmentOutlinedIcon} iconColor="primary" />
        </Grid>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <StatTile label="Under Review" value={counts.review} sub="Awaiting review" icon={AccessTimeOutlinedIcon} iconColor="error" />
        </Grid>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <StatTile label="In Progress" value={counts.progress} sub="Being addressed" icon={HourglassEmptyOutlinedIcon} iconColor="warning" />
        </Grid>
        <Grid size={{ xs: 6, md: 2.4 }}>
          <StatTile label="Completed" value={counts.done} sub="Last 30 days" icon={CheckCircleOutlineIcon} iconColor="success" />
        </Grid>
        <Grid size={{ xs: 12, md: 2.4 }}>
          <StatTile
            label="Avg Resolution"
            value={avgResolutionDays ?? '—'}
            sub={avgResolutionDays ? 'Days' : 'No closed reports yet'}
            icon={VerifiedOutlinedIcon}
            iconColor="secondary"
          />
        </Grid>
      </Grid>

      {/* Overview + trend + quick actions */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
            <PanelHeader
              title="My Reports Overview"
              action={
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={period}
                  onChange={(_, v) => v && setPeriod(v)}
                >
                  <ToggleButton value="month" sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
                    This month
                  </ToggleButton>
                  <ToggleButton value="all" sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
                    All time
                  </ToggleButton>
                </ToggleButtonGroup>
              }
            />
            {donutTotal === 0 ? (
              <EmptyState dense icon={AssignmentOutlinedIcon} description="No reports in this period." />
            ) : (
              <Stack direction="row" spacing={3} alignItems="center">
                <Box sx={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
                  <Doughnut data={donutData} options={{ plugins: { legend: { display: false } }, cutout: '70%' }} />
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography variant="h5" fontWeight={700}>
                      {donutTotal}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Total
                    </Typography>
                  </Box>
                </Box>
                <Stack spacing={1}>
                  {Object.entries(STATUS_GROUPS).map(([key, group]) => (
                    <Stack key={key} direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: `${group.color}.main` }} />
                      <Typography variant="body2">
                        {group.label} · {periodCounts[key]}
                        {donutTotal > 0 && ` (${Math.round((periodCounts[key] / donutTotal) * 100)}%)`}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
            <PanelHeader
              title="Reports Trend"
              action={
                <Link component={RouterLink} to="/my-reports" underline="hover" variant="body2">
                  View all
                </Link>
              }
            />
            <Box sx={{ height: 160 }}>
              <Line
                data={trendData}
                options={{
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { grid: { display: false } },
                  },
                }}
              />
            </Box>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
            <PanelHeader title="Quick Actions" />
            <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
              {QUICK_ACTIONS.map(({ label, caption, to, icon: Icon, color }) => (
                <Stack
                  key={to}
                  component={RouterLink}
                  to={to}
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                  sx={{ py: 1.25, textDecoration: 'none', color: 'inherit' }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      flexShrink: 0,
                      color: `${color}.main`,
                      bgcolor: (t) => alpha(t.palette[color].main, 0.12),
                    }}
                  >
                    <Icon fontSize="small" />
                  </Box>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {caption}
                    </Typography>
                  </Box>
                  <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </Stack>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Recent reports + around the estate + notices */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
            <PanelHeader
              title="My Recent Reports"
              action={
                <Link component={RouterLink} to="/my-reports" underline="hover" variant="body2">
                  View all
                </Link>
              }
            />
            <TextField
              size="small"
              fullWidth
              placeholder="Search by issue, block or status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
              sx={{ mb: 2 }}
            />
            {recentReports.length === 0 ? (
              <EmptyState
                dense
                icon={AssignmentOutlinedIcon}
                description={search ? 'No reports match your search.' : "You haven't filed any reports yet."}
                actionLabel={search ? undefined : 'Report an issue'}
                actionTo={search ? undefined : '/report'}
              />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Issue</TableCell>
                      <TableCell>Location</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Updated</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentReports.map((r) => (
                      <TableRow key={r.id} hover>
                        <TableCell sx={{ maxWidth: 180 }}>
                          <Typography variant="body2" noWrap>
                            {r.title}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            Block {r.location_block}
                            {r.location_unit ? ` · #${r.location_unit}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" variant="outlined" color={statusDisplay(r.status).color} label={statusDisplay(r.status).label} />
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="caption" color="text.secondary">
                            {timeAgo(r.updated_at ?? r.created_at)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
            <PanelHeader
              title="Around the Estate"
              action={
                <Link component={RouterLink} to="/status-board" underline="hover" variant="body2">
                  View all
                </Link>
              }
            />
            {estate.length === 0 ? (
              <EmptyState dense icon={ApartmentOutlinedIcon} description="Nothing reported around the estate yet." />
            ) : (
              <Stack spacing={1.5}>
                {Object.entries(STATUS_GROUPS).map(([key, group]) => (
                  <Stack
                    key={key}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ p: 1.25, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette[group.color].main, 0.06) }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: `${group.color}.main` }} />
                      <Typography variant="body2" fontWeight={600}>
                        {group.label}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" fontWeight={700} sx={{ color: `${group.color}.main` }}>
                      {estateCounts[key]}
                    </Typography>
                  </Stack>
                ))}
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    Total reports
                  </Typography>
                  <Typography variant="body2" fontWeight={700}>
                    {estate.length}
                  </Typography>
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 3 }}>
          <Paper
            variant="outlined"
            sx={{ p: 2.5, borderRadius: 2, height: '100%', borderStyle: 'dashed' }}
          >
            <PanelHeader
              title="Notices"
              action={
                <Link component={RouterLink} to="/notices" underline="hover" variant="body2">
                  View all
                </Link>
              }
            />
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <CampaignOutlinedIcon sx={{ color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                Estate notices from your town council will appear here soon.
              </Typography>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
