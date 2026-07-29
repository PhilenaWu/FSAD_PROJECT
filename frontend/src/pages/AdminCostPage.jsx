// UC-011 Admin cost analytics dashboard. Mirrors the manager dashboard's
// interaction model: KPI row → URL-persisted filter bar (with quick ranges) →
// top-mover callout → charts (incl. next-month projection) → repair-vs-replace
// lift watchlist → sortable cost-per-contractor table → recent costed jobs
// with outlier flags, plus CSV export, skeletons, and a retry banner.
// All figures are operational maintenance costs from this system's own records
// (actual_cost entered at close, UC-004, plus the projected cost of active AI
// risk alerts, UC-006) — not corporate financials. Role-gated to `admin`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  Grid2 as Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import CloseIcon from '@mui/icons-material/Close';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Legend,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { downloadCsv } from '../utils/csvDownload';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import {
  getCostFilterOptions,
  getCostSummary,
  getCostAnalytics,
  getLiftWatchlist,
  buildInsights,
  LIFT_REPLACEMENT_REVIEW_COST,
} from '../services/costService';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Legend, ChartTooltip);

// `contractorId` holds the contractor's UUID — the backend filters on the
// foreign key, not on a display name that could change.
const FILTER_KEYS = ['from', 'to', 'block', 'category', 'contractorId'];

// "$18,240.50" — SGD operational maintenance costs.
const fmtMoney = (n) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isoDaysAgo = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// Quick-range presets for the filter bar chips.
const QUICK_RANGES = [
  { label: 'Last 30 days', from: () => isoDaysAgo(30), to: () => '' },
  { label: 'Last 90 days', from: () => isoDaysAgo(90), to: () => '' },
  { label: 'This year', from: () => `${new Date().getFullYear()}-01-01`, to: () => '' },
  { label: 'All time', from: () => '', to: () => '' },
];

// KPI stat tile — same visual language as the UC-005 KpiRow tiles.
function Tile({ label, value, sub, trend, trendLabel }) {
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

// Chart/section wrapper — outlined Paper with a title and a period subtitle so
// each panel states the window its numbers cover.
function Panel({ title, subtitle, action, children }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box>
          {/* component="div": titles may contain a Chip (a div), invalid inside h6. */}
          <Typography variant="subtitle1" component="div" fontWeight={700}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2, minHeight: 18 }}>
            {subtitle}
          </Typography>
        </Box>
        {action && <Box sx={{ displayPrint: 'none' }}>{action}</Box>}
      </Stack>
      {children}
    </Paper>
  );
}

// Clicking a bar drills down: the page sets that category as the active
// filter (mirrors the manager heatmap's click-to-drill-down).
function CategoryBarChart({ data, onBarClick, chartRef }) {
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

// Monthly actuals as a solid line; the 3-month projection (damped-trend
// exponential smoothing on complete months) continues it as a dashed amber
// curve inside a shaded ~80% uncertainty band derived from the model's own
// historical errors.
function CostTrendChart({ data, forecast, chartRef }) {
  const theme = useTheme();
  const points = forecast?.points ?? [];
  const labels = [...data.map((d) => d.month), ...points.map((p) => p.month)];
  const lastActual = data[data.length - 1]?.actual_cost ?? null;

  // Nulls across the actual months (anchored on the last one), then the
  // projected series — so the dashed curve continues the solid line.
  const projectionSeries = (values) => [
    ...data.map((d, i) => (i === data.length - 1 ? lastActual : null)),
    ...values,
  ];

  const datasets = [
    {
      label: 'Actual spend',
      data: [...data.map((d) => d.actual_cost), ...points.map(() => null)],
      borderColor: theme.palette.primary.main,
      backgroundColor: alpha(theme.palette.primary.main, 0.08),
      pointBackgroundColor: theme.palette.primary.main,
      pointRadius: 3,
      tension: 0.3,
      fill: true,
    },
  ];
  if (points.length) {
    // Band edges first (hidden from legend/tooltip via the '_' prefix);
    // the upper edge fills down to the lower edge drawn just before it.
    datasets.push(
      {
        label: '_band_lower',
        data: projectionSeries(points.map((p) => p.lower)),
        borderWidth: 0,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
      },
      {
        label: '_band_upper',
        data: projectionSeries(points.map((p) => p.upper)),
        borderWidth: 0,
        pointRadius: 0,
        backgroundColor: alpha(theme.palette.warning.main, 0.15),
        tension: 0.3,
        fill: '-1',
      },
      {
        label: 'Projected (damped trend)',
        data: projectionSeries(points.map((p) => p.value)),
        borderColor: theme.palette.warning.dark,
        borderDash: [6, 4],
        pointBackgroundColor: theme.palette.warning.dark,
        pointStyle: 'rectRot',
        pointRadius: 4,
        tension: 0.3,
        fill: false,
      }
    );
  }

  const options = {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: points.length > 0,
        position: 'bottom',
        labels: {
          boxWidth: 24,
          filter: (item) => !item.text.startsWith('_'),
        },
        onClick: null,
      },
      tooltip: {
        filter: (item) => !item.dataset.label.startsWith('_'),
        callbacks: {
          label: (item) => {
            const projIndex = item.dataIndex - data.length;
            if (item.dataset.label.startsWith('Projected') && projIndex >= 0) {
              const p = points[projIndex];
              return `${fmtMoney(p.value)} projected (likely ${fmtMoney(p.lower)}–${fmtMoney(p.upper)})`;
            }
            const row = data[item.dataIndex];
            return row ? `${fmtMoney(item.raw)} across ${row.jobs} job${row.jobs === 1 ? '' : 's'}` : fmtMoney(item.raw);
          },
        },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (v) => `$${Number(v).toLocaleString()}` } },
      x: { grid: { display: false } },
    },
  };
  return <Line ref={chartRef} data={{ labels, datasets }} options={options} />;
}

// Watchlist row status from lifetime spend vs the review threshold.
function liftStatusChip(pct) {
  if (pct >= 100) return <Chip size="small" color="error" label="Review replacement" />;
  if (pct >= 75) return <Chip size="small" color="warning" label="Approaching review" />;
  return <Chip size="small" color="success" label="Healthy" />;
}

export default function AdminCostPage() {
  const { profile } = useAuth();
  const { socket } = useSocket();

  // Filters live in the URL query string so a filtered view is bookmarkable
  // and shareable — same pattern as the manager dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) ?? ''])),
    [searchParams]
  );
  const dateRangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);

  const [filterOptions, setFilterOptions] = useState({ blocks: [], categories: [], contractors: [] });
  const [summary, setSummary] = useState(null);
  const [byCategory, setByCategory] = useState([]);
  const [byContractor, setByContractor] = useState([]);
  const [trend, setTrend] = useState({ data: [], forecast: null, backtest: null, top_mover: null });
  const [jobs, setJobs] = useState([]);
  const [lifts, setLifts] = useState([]);
  const [benchmarks, setBenchmarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);

  // Contractor table sort — cost-heaviest first by default.
  const [sort, setSort] = useState({ key: 'actual_cost', dir: 'desc' });

  // UC-004 → UC-011 live link: a manager closing a job (which records the
  // actual_cost) prompts this dashboard to refresh.
  const [closeSeen, setCloseSeen] = useState(false);

  // Chart canvases, for the per-panel PNG download.
  const categoryChartRef = useRef(null);
  const trendChartRef = useRef(null);

  // `isStale` lets the effect below disown a request whose filters have since
  // changed. Without it, a slow request for the old filters can resolve after
  // a fast one for the new filters and repaint the page with figures that
  // contradict the filter bar — the reader has no way to tell.
  const fetchAll = useCallback(async (isStale = () => false) => {
    if (dateRangeInvalid) return; // hold the last good data; the filter bar shows the error
    setLoading(true);
    setFetchFailed(false);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    try {
      // Three requests: the KPI aggregates, everything derived from the
      // filtered job rows, and the watchlist's lifetime rows.
      const [s, an, lf] = await Promise.all([
        getCostSummary(params),
        getCostAnalytics(params),
        getLiftWatchlist(params),
      ]);
      if (isStale()) return;
      setSummary(s);
      setByCategory(an.byCategory);
      setByContractor(an.byContractor);
      setTrend(an.trend);
      setJobs(an.jobs);
      setBenchmarks(an.benchmarks);
      setLifts(lf.data);
    } catch {
      if (isStale()) return;
      setFetchFailed(true);
    } finally {
      // A superseded request must not clear the spinner the newer one raised.
      if (!isStale()) setLoading(false);
    }
  }, [filters, dateRangeInvalid]);

  useEffect(() => {
    let superseded = false;
    fetchAll(() => superseded);
    return () => {
      superseded = true;
    };
  }, [fetchAll]);

  // Dropdown options — once per visit; failures just leave them empty.
  useEffect(() => {
    getCostFilterOptions()
      .then(setFilterOptions)
      .catch(() => {});
  }, []);

  // Live update: the UC-004 close emits status_update to admin-room with
  // status 'Closed'. Prompt rather than auto-refetch so a burst of closes
  // can't yank charts around mid-read.
  useEffect(() => {
    if (!socket) return undefined;
    const onStatusUpdate = (payload) => {
      if (payload?.status === 'Closed') setCloseSeen(true);
    };
    socket.on('status_update', onStatusUpdate);
    return () => socket.off('status_update', onStatusUpdate);
  }, [socket]);

  // Charts must re-measure for the narrower paper size before the browser
  // snapshots the page, then again after to restore the screen layout —
  // print doesn't fire the resize events Chart.js normally listens to.
  useEffect(() => {
    const resizeCharts = () => {
      categoryChartRef.current?.resize();
      trendChartRef.current?.resize();
    };
    window.addEventListener('beforeprint', resizeCharts);
    window.addEventListener('afterprint', resizeCharts);
    return () => {
      window.removeEventListener('beforeprint', resizeCharts);
      window.removeEventListener('afterprint', resizeCharts);
    };
  }, []);

  // chart.toBase64Image() → download, for pasting into slides (4C-2 pain point).
  const downloadChartPng = (ref, filename) => {
    const chart = ref.current;
    if (!chart) return;
    const a = document.createElement('a');
    a.href = chart.toBase64Image();
    a.download = filename;
    a.click();
  };

  const setFilter = (key) => (e) => {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) {
      next.set(key, e.target.value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const clearFilter = (key) => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const setCategoryFilter = (category) => {
    const next = new URLSearchParams(searchParams);
    next.set('category', category);
    setSearchParams(next, { replace: true });
  };

  const clearAllFilters = () => setSearchParams(new URLSearchParams(), { replace: true });
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);

  const applyQuickRange = (range) => {
    const next = new URLSearchParams(searchParams);
    const from = range.from();
    const to = range.to();
    if (from) next.set('from', from); else next.delete('from');
    if (to) next.set('to', to); else next.delete('to');
    setSearchParams(next, { replace: true });
  };

  const clearAdornment = (key, label = key) =>
    filters[key] ? (
      <InputAdornment position="end" sx={{ mr: 2 }}>
        <IconButton
          size="small"
          edge="end"
          aria-label={`Clear ${label} filter`}
          onClick={() => clearFilter(key)}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </InputAdornment>
    ) : null;

  const sortedContractors = useMemo(() => {
    const rows = [...byContractor];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const cmp = typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key];
      return dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [byContractor, sort]);

  const toggleSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const sortLabel = (key, label) => (
    <TableSortLabel
      active={sort.key === key}
      direction={sort.key === key ? sort.dir : 'desc'}
      onClick={() => toggleSort(key)}
    >
      {label}
    </TableSortLabel>
  );

  // Per-category average job cost — flags outlier jobs (>2× category average)
  // in the recent-jobs table so unusual invoices stand out.
  const categoryAvg = useMemo(
    () => Object.fromEntries(byCategory.map((c) => [c.category, c.jobs ? c.actual_cost / c.jobs : 0])),
    [byCategory]
  );

  // Auto-written executive summary — recomputed from the filtered aggregates.
  // (Must stay above the role-gate return: hooks can't be conditional.)
  const insights = useMemo(
    () =>
      buildInsights({
        summary,
        byCategory,
        byContractor,
        mover: trend.top_mover,
        lifts,
        forecast: trend.forecast,
      }),
    [summary, byCategory, byContractor, trend, lifts]
  );

  // Belt-and-braces role gate — the layout and backend also enforce `admin`.
  if (profile && profile.role !== 'admin') {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">This dashboard is only available to administrators.</Alert>
      </Container>
    );
  }

  const periodLabel =
    filters.from || filters.to
      ? `${filters.from || 'start'} → ${filters.to || 'today'}`
      : 'all time';
  const avgPerJob = summary?.jobs ? summary.total_actual / summary.jobs : null;
  const chartSkeleton = <Skeleton variant="rounded" height={300} />;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header row: title + export */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 0.5 }}
      >
        <Typography variant="h5" fontWeight={700}>
          Cost Analytics
        </Typography>
        <Stack direction="row" spacing={1} sx={{ displayPrint: 'none' }}>
          <Button
            variant="outlined"
            startIcon={<PrintOutlinedIcon />}
            onClick={() => window.print()}
          >
            Print / PDF
          </Button>
          <Tooltip title={jobs.length ? '' : 'No costed jobs match the current filters — nothing to export.'}>
            <span>
              <Button
                variant="outlined"
                startIcon={<FileDownloadOutlinedIcon />}
                disabled={!jobs.length}
                onClick={() => downloadCsv(jobs, 'costed-jobs.csv')}
              >
                Export CSV
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Operational maintenance spend from closed jobs (entered at close-out) and the projected
        cost of active AI risk alerts. Not corporate financials.
      </Typography>

      {fetchFailed && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            // Wrapped: onClick would otherwise hand the click event to
            // fetchAll's first parameter.
            <Button color="inherit" size="small" onClick={() => fetchAll()}>
              Retry
            </Button>
          }
        >
          Could not load cost data — try again.
        </Alert>
      )}

      {/* KPI row */}
      {summary ? (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 6, md: 3 }}>
            <Tile
              label="Total maintenance spend"
              value={fmtMoney(summary.total_actual)}
              sub={`${summary.jobs} closed job${summary.jobs === 1 ? '' : 's'}, ${periodLabel}`}
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Tile
              label="Spend movement"
              value={
                summary.variance_pct == null
                  ? '—'
                  : `${summary.variance_pct > 0 ? '+' : ''}${summary.variance_pct}%`
              }
              trend={summary.variance_pct}
              trendLabel="vs prior period"
              sub={
                summary.variance_pct == null
                  ? 'no prior-period spend to compare'
                  : `prior period: ${fmtMoney(summary.prior_actual)}`
              }
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Tile
              label="Projected exposure"
              value={fmtMoney(summary.total_projected)}
              sub="active AI risk alerts, if left unaddressed"
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Tile
              label="Avg cost per job"
              value={fmtMoney(avgPerJob)}
              sub="total spend ÷ closed jobs"
            />
          </Grid>
        </Grid>
      ) : (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[0, 1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 6, md: 3 }}>
              <Skeleton variant="rounded" height={96} />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Filter bar — quick ranges + period / block / category / contractor,
          persisted in the URL. Hidden when printing — a snapshot needs the
          numbers, not the controls. */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3, displayPrint: 'none' }}>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          {QUICK_RANGES.map((r) => {
            const active = filters.from === r.from() && filters.to === r.to();
            return (
              <Chip
                key={r.label}
                label={r.label}
                size="small"
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                onClick={() => applyQuickRange(r)}
              />
            );
          })}
          {hasFilters && (
            <Chip
              label="Clear all filters"
              size="small"
              variant="outlined"
              color="warning"
              onDelete={clearAllFilters}
              onClick={clearAllFilters}
            />
          )}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            label="From"
            type="date"
            value={filters.from}
            onChange={setFilter('from')}
            error={dateRangeInvalid}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label="To"
            type="date"
            value={filters.to}
            onChange={setFilter('to')}
            error={dateRangeInvalid}
            helperText={dateRangeInvalid ? '"From" must be on or before "To"' : ''}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Block</InputLabel>
            <Select
              label="Block"
              value={filters.block}
              onChange={setFilter('block')}
              endAdornment={clearAdornment('block')}
            >
              <MenuItem value="">All blocks</MenuItem>
              {filterOptions.blocks.map((b) => (
                <MenuItem key={b} value={b}>{b}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Category</InputLabel>
            <Select
              label="Category"
              value={filters.category}
              onChange={setFilter('category')}
              endAdornment={clearAdornment('category')}
            >
              <MenuItem value="">All categories</MenuItem>
              {filterOptions.categories.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Contractor</InputLabel>
            <Select
              label="Contractor"
              value={filters.contractorId}
              onChange={setFilter('contractorId')}
              endAdornment={clearAdornment('contractorId', 'contractor')}
            >
              <MenuItem value="">All contractors</MenuItem>
              {filterOptions.contractors.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {/* Insights — auto-written executive summary of the current view,
          derived by fixed rules from the filtered aggregates (no AI). */}
      {!loading && insights.length > 0 && (
        <Paper
          variant="outlined"
          sx={{ p: 2.5, borderRadius: 2, mb: 3, borderColor: 'primary.main', bgcolor: (t) => alpha(t.palette.primary.main, 0.03) }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <LightbulbOutlinedIcon fontSize="small" color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              Insights
            </Typography>
            <Typography variant="caption" color="text.secondary">
              generated from the current view
            </Typography>
          </Stack>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 3 }}>
            {insights.map((s) => (
              <Typography key={s} component="li" variant="body2">
                {s}
              </Typography>
            ))}
          </Stack>
        </Paper>
      )}

      {/* Charts row */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Panel
            title="Spend by category"
            subtitle={`Closed jobs, ${periodLabel} — click a bar to filter`}
            action={
              <Tooltip title="Download chart as PNG (for slides)">
                <IconButton size="small" onClick={() => downloadChartPng(categoryChartRef, 'spend-by-category.png')}>
                  <ImageOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            }
          >
            {loading ? (
              chartSkeleton
            ) : byCategory.length ? (
              <Box sx={{ height: 300 }}>
                <CategoryBarChart data={byCategory} onBarClick={setCategoryFilter} chartRef={categoryChartRef} />
              </Box>
            ) : (
              <Alert severity="info">No costed jobs match the current filters.</Alert>
            )}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Panel
            title={
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <span>Monthly spend trend</span>
                {trend.backtest && (
                  <Tooltip
                    title={
                      <Box>
                        <Typography variant="caption" fontWeight={700} component="div" sx={{ mb: 0.5 }}>
                          Walk-forward backtest — the model refit on each month&apos;s prior
                          history only, then graded against the real total:
                        </Typography>
                        {trend.backtest.rows.map((r) => (
                          <Typography key={r.month} variant="caption" component="div">
                            {r.month}: predicted {fmtMoney(r.predicted)} · actual {fmtMoney(r.actual)} (
                            {r.error_pct > 0 ? '+' : ''}{r.error_pct}%)
                          </Typography>
                        ))}
                      </Box>
                    }
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      color={trend.backtest.mape <= 15 ? 'success' : trend.backtest.mape <= 30 ? 'warning' : 'error'}
                      label={`Backtested: ±${trend.backtest.mape}% avg error over ${trend.backtest.rows.length} month${trend.backtest.rows.length === 1 ? '' : 's'}`}
                    />
                  </Tooltip>
                )}
              </Stack>
            }
            subtitle={`Closed jobs by month, ${periodLabel}${trend.forecast ? ' — dashed: 3-month projection with likely range' : ''}`}
            action={
              <Tooltip title="Download chart as PNG (for slides)">
                <IconButton size="small" onClick={() => downloadChartPng(trendChartRef, 'monthly-spend-trend.png')}>
                  <ImageOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            }
          >
            {loading ? (
              chartSkeleton
            ) : trend.data.length ? (
              <Box sx={{ height: 300 }}>
                <CostTrendChart data={trend.data} forecast={trend.forecast} chartRef={trendChartRef} />
              </Box>
            ) : (
              <Alert severity="info">No costed jobs match the current filters.</Alert>
            )}
          </Panel>
        </Grid>
      </Grid>

      {/* Repair-vs-replace lift watchlist — lifetime spend vs review threshold */}
      <Box sx={{ mb: 3 }}>
        <Panel
          title="Lift watchlist — repair vs replace"
          subtitle={`Lifetime maintenance spend per lift vs the ${fmtMoney(LIFT_REPLACEMENT_REVIEW_COST)} replacement-review threshold (date filters don't apply — the whole life counts)`}
        >
          {loading ? (
            <Skeleton variant="rounded" height={160} />
          ) : lifts.length ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Lift</TableCell>
                    <TableCell>Block</TableCell>
                    <TableCell align="right">Jobs</TableCell>
                    <TableCell align="right">Lifetime spend</TableCell>
                    <TableCell sx={{ width: '28%' }}>Toward review threshold</TableCell>
                    <TableCell align="right">Est. time to review</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lifts.map((l) => (
                    <TableRow key={l.lift} hover>
                      <TableCell>{l.lift}</TableCell>
                      <TableCell>{l.block}</TableCell>
                      <TableCell align="right">{l.jobs}</TableCell>
                      <TableCell align="right">{fmtMoney(l.actual_cost)}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(l.pct_of_threshold, 100)}
                            color={l.pct_of_threshold >= 100 ? 'error' : l.pct_of_threshold >= 75 ? 'warning' : 'success'}
                            sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                          />
                          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36 }}>
                            {l.pct_of_threshold}%
                          </Typography>
                        </Stack>
                      </TableCell>
                      {/* Projection from the lift's average spend rate over
                          the last 6 complete months; — when no recent spend. */}
                      <TableCell align="right">
                        {l.months_to_review === 0
                          ? 'now'
                          : l.months_to_review != null
                            ? `~${l.months_to_review} mo`
                            : '—'}
                      </TableCell>
                      <TableCell>{liftStatusChip(l.pct_of_threshold)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Alert severity="info">No lift-linked costed jobs match the current filters.</Alert>
          )}
        </Panel>
      </Box>

      {/* Cost per contractor — sortable; pairs with the UC-005 scorecard */}
      <Box sx={{ mb: 3 }}>
        <Panel title="Cost per contractor" subtitle={`Closed jobs, ${periodLabel}`}>
          {loading ? (
            <Skeleton variant="rounded" height={160} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{sortLabel('contractor', 'Contractor')}</TableCell>
                    <TableCell align="right">{sortLabel('jobs', 'Jobs')}</TableCell>
                    <TableCell align="right">{sortLabel('actual_cost', 'Actual cost')}</TableCell>
                    <TableCell align="right">Avg cost / job</TableCell>
                    <TableCell align="right">Share of spend</TableCell>
                    <TableCell align="right">Vs peers</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedContractors.map((row) => (
                    <TableRow key={row.contractor} hover>
                      <TableCell>{row.contractor}</TableCell>
                      <TableCell align="right">{row.jobs}</TableCell>
                      <TableCell align="right">{fmtMoney(row.actual_cost)}</TableCell>
                      <TableCell align="right">
                        {row.jobs ? fmtMoney(row.actual_cost / row.jobs) : '—'}
                      </TableCell>
                      <TableCell align="right">
                        {summary?.total_actual
                          ? `${Math.round((row.actual_cost / summary.total_actual) * 100)}%`
                          : '—'}
                      </TableCell>
                      {/* Price benchmark: avg cost/job vs peers WITHIN the same
                          category, so job mix doesn't confound the comparison. */}
                      <TableCell align="right">
                        {benchmarks[row.contractor] ? (
                          <Tooltip
                            title={`Average cost per ${benchmarks[row.contractor].category} job vs other contractors' ${benchmarks[row.contractor].category} jobs in this view`}
                          >
                            <Chip
                              size="small"
                              variant="outlined"
                              color={benchmarks[row.contractor].deviation_pct > 0 ? 'error' : 'success'}
                              label={`${benchmarks[row.contractor].deviation_pct > 0 ? '+' : ''}${benchmarks[row.contractor].deviation_pct}% on ${benchmarks[row.contractor].category}`}
                            />
                          </Tooltip>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            in line
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {sortedContractors.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                          No costed jobs match the current filters.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Panel>
      </Box>

      {/* Recent costed jobs — the drill-down behind the aggregates. Jobs
          costing over 2× their category's average get an outlier flag. */}
      <Panel
        title="Recent costed jobs"
        subtitle={`Latest close-outs with a recorded cost, ${periodLabel} — showing ${Math.min(jobs.length, 10)} of ${jobs.length}`}
      >
        {loading ? (
          <Skeleton variant="rounded" height={240} />
        ) : jobs.length ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Closed</TableCell>
                  <TableCell>Block</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Contractor</TableCell>
                  <TableCell align="right">Actual cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.slice(0, 10).map((j) => {
                  const avg = categoryAvg[j.category];
                  const outlier = avg > 0 && j.actual_cost > 2 * avg;
                  return (
                    <TableRow key={j.id} hover>
                      <TableCell>{j.closed_at}</TableCell>
                      <TableCell>{j.block}</TableCell>
                      <TableCell>{j.category}</TableCell>
                      <TableCell>{j.contractor}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                          {outlier && (
                            <Tooltip title={`Over 2× the ${j.category} average of ${fmtMoney(avg)}`}>
                              <Chip size="small" color="warning" label="Outlier" />
                            </Tooltip>
                          )}
                          <span>{fmtMoney(j.actual_cost)}</span>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Alert severity="info">No costed jobs match the current filters.</Alert>
        )}
      </Panel>

      {/* UC-004 → UC-011 live link: prompt (not auto-refresh) when a job is
          closed elsewhere, so charts don't move under the admin mid-read. */}
      <Snackbar
        open={closeSeen}
        onClose={() => setCloseSeen(false)}
        message="A job was just closed with a recorded cost."
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        action={
          <Button
            color="primary"
            size="small"
            onClick={() => {
              setCloseSeen(false);
              fetchAll();
            }}
          >
            Refresh view
          </Button>
        }
      />
    </Container>
  );
}
