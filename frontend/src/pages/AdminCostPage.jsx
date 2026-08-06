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
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import SlideshowOutlinedIcon from '@mui/icons-material/SlideshowOutlined';
import CloseIcon from '@mui/icons-material/Close';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import ShowChartOutlinedIcon from '@mui/icons-material/ShowChartOutlined';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { downloadCsv } from '../utils/csvDownload';
import CostTile from '../components/cost/CostTile';
import CostPanel from '../components/cost/CostPanel';
import CategoryBarChart from '../components/cost/CategoryBarChart';
import CostTrendChart from '../components/cost/CostTrendChart';
import liftStatusChip from '../components/cost/liftStatusChip';
import { fmtMoney } from '../components/cost/formatMoney';
import useTableSort from '../components/common/useTableSort';
import {
  getCostFilterOptions,
  getCostSummary,
  getCostAnalytics,
  getLiftWatchlist,
  exportCostPptx,
  buildInsights,
  LIFT_REPLACEMENT_REVIEW_COST,
} from '../services/costService';

// `contractorId` holds the contractor's UUID — the backend filters on the
// foreign key, not on a display name that could change.
const FILTER_KEYS = ['from', 'to', 'block', 'category', 'contractorId'];

// How many job rows the drill-down table shows before "All" is chosen.
const JOBS_PREVIEW_COUNT = 10;

const isoDaysAgo = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// Quick-range presets for the filter bar chips.
const QUICK_RANGES = [
  { label: 'Last 30 days', from: () => isoDaysAgo(30), to: () => '' },
  { label: 'Last 90 days', from: () => isoDaysAgo(90), to: () => '' },
  { label: 'This year', from: () => `${new Date().getFullYear()}-01-01`, to: () => '' },
  { label: 'All time', from: () => '', to: () => '' },
];

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

  // Both tables sort the same way — cost-heaviest first by default.
  const contractorSort = useTableSort('actual_cost');
  const jobsSort = useTableSort('closed_at');

  // Job-table-only controls. These narrow what the table shows without
  // touching the charts or the KPIs, the same way the manager dashboard's
  // priority queue has its own view controls. The filter bar at the top of
  // the page re-queries the server and moves everything; these do not.
  const [jobsLimit, setJobsLimit] = useState(JOBS_PREVIEW_COUNT);
  const [outliersOnly, setOutliersOnly] = useState(false);
  const [jobsCategory, setJobsCategory] = useState('');
  const [jobsContractor, setJobsContractor] = useState('');

  // UC-004 → UC-011 live link: a manager closing a job (which records the
  // actual_cost) prompts this dashboard to refresh.
  const [closeSeen, setCloseSeen] = useState(false);

  // PowerPoint export — the deck is built server-side, so it takes a moment.
  const [pptxBusy, setPptxBusy] = useState(false);
  const [toast, setToast] = useState('');

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

  // Server-rendered cost deck (4C-2 pain point — the weekly meeting pack).
  // Opens in a new tab rather than navigating away from the filtered view.
  const handleExportPptx = async () => {
    setPptxBusy(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { pptx_url: url } = await exportCostPptx(params);
      if (url) {
        window.open(url, '_blank', 'noopener');
        setToast('PowerPoint deck ready — opened in a new tab.');
      } else {
        setToast('The deck was built but no download link came back.');
      }
    } catch (err) {
      setToast(err.response?.data?.message || 'Could not build the PowerPoint deck.');
    } finally {
      setPptxBusy(false);
    }
  };

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

  const sortedContractors = useMemo(
    () => contractorSort.sortRows(byContractor),
    [byContractor, contractorSort]
  );

  // Per-category average job cost — flags outlier jobs (>2× category average)
  // in the recent-jobs table so unusual invoices stand out.
  const categoryAvg = useMemo(
    () => Object.fromEntries(byCategory.map((c) => [c.category, c.jobs ? c.actual_cost / c.jobs : 0])),
    [byCategory]
  );

  // A job billed at more than twice its category's average in the current
  // view. The comparison is against the filtered aggregate, so narrowing the
  // filters re-decides what counts as unusual.
  const isOutlier = useCallback(
    (job) => {
      const avg = categoryAvg[job.category];
      return avg > 0 && job.actual_cost > 2 * avg;
    },
    [categoryAvg]
  );

  // The job rows the table actually renders: table-local filters, then sort,
  // then the row cap. Sorting before capping matters — otherwise "highest
  // cost" would only ever sort the ten rows that happened to be newest.
  const jobRows = useMemo(() => {
    const filtered = jobs.filter(
      (j) =>
        (!jobsCategory || j.category === jobsCategory) &&
        (!jobsContractor || j.contractor === jobsContractor) &&
        (!outliersOnly || isOutlier(j))
    );
    return jobsSort.sortRows(filtered);
  }, [jobs, jobsCategory, jobsContractor, outliersOnly, isOutlier, jobsSort]);

  const visibleJobs = jobsLimit === Infinity ? jobRows : jobRows.slice(0, jobsLimit);
  const outlierCount = useMemo(() => jobs.filter(isOutlier).length, [jobs, isOutlier]);
  const jobsFiltered = Boolean(jobsCategory || jobsContractor || outliersOnly);

  // Options come from the rows on screen, not the whole estate — an option
  // that cannot match anything in the current view would be a dead end.
  const jobCategories = useMemo(
    () => [...new Set(jobs.map((j) => j.category))].sort(),
    [jobs]
  );
  const jobContractors = useMemo(
    () => [...new Set(jobs.map((j) => j.contractor))].sort(),
    [jobs]
  );

  // The four orders worth a one-click shortcut. Column headers and this
  // control share one sort state, so clicking either keeps the other honest.
  const JOB_ORDERS = [
    { label: 'Newest first', key: 'closed_at', dir: 'desc' },
    { label: 'Oldest first', key: 'closed_at', dir: 'asc' },
    { label: 'Highest cost', key: 'actual_cost', dir: 'desc' },
    { label: 'Lowest cost', key: 'actual_cost', dir: 'asc' },
  ];
  const activeOrder =
    JOB_ORDERS.find((o) => o.key === jobsSort.sort.key && o.dir === jobsSort.sort.dir)?.label ?? '';

  const clearJobFilters = () => {
    setJobsCategory('');
    setJobsContractor('');
    setOutliersOnly(false);
  };

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
          {/* The deck is rendered server-side from the same figures, so it
              cannot drift from the screen. */}
          <Tooltip title={jobs.length ? '' : 'No costed jobs match the current filters — nothing to export.'}>
            <span>
              <Button
                variant="outlined"
                startIcon={<SlideshowOutlinedIcon />}
                disabled={!jobs.length || pptxBusy}
                onClick={handleExportPptx}
              >
                {pptxBusy ? 'Building…' : 'PowerPoint'}
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
            <CostTile
              label="Total maintenance spend"
              value={summary.total_actual}
              format={fmtMoney}
              sub={`${summary.jobs} closed job${summary.jobs === 1 ? '' : 's'}, ${periodLabel}`}
              icon={PaymentsOutlinedIcon}
              iconColor="secondary"
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <CostTile
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
              icon={ShowChartOutlinedIcon}
              iconColor="secondary"
            />
          </Grid>
          {/* AI alerts carry block+category only — no contractor. With a
              contractor filter active the server zeroes the projected series
              (unattributable), so say that instead of a silent $0.00. */}
          <Grid size={{ xs: 6, md: 3 }}>
            <CostTile
              label="Projected exposure"
              value={filters.contractorId ? '—' : summary.total_projected}
              format={fmtMoney}
              sub={
                filters.contractorId
                  ? 'not shown per contractor — AI alerts are not attributed to one'
                  : 'active AI risk alerts, if left unaddressed'
              }
              icon={WarningAmberOutlinedIcon}
              iconColor="warning"
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <CostTile
              label="Avg cost per job"
              value={avgPerJob}
              format={fmtMoney}
              sub="total spend ÷ closed jobs"
              icon={ReceiptLongOutlinedIcon}
              iconColor="info"
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
          <CostPanel
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
          </CostPanel>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <CostPanel
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
          </CostPanel>
        </Grid>
      </Grid>

      {/* Repair-vs-replace lift watchlist — lifetime spend vs review threshold */}
      <Box sx={{ mb: 3 }}>
        <CostPanel
          title="Lift watchlist — repair vs replace"
          subtitle={`Lifetime maintenance spend per lift vs the ${fmtMoney(LIFT_REPLACEMENT_REVIEW_COST)} replacement-review threshold (date filters don't apply — the whole life counts; the block filter still narrows the list)`}
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
        </CostPanel>
      </Box>

      {/* Cost per contractor — sortable; pairs with the UC-005 scorecard */}
      <Box sx={{ mb: 3 }}>
        <CostPanel title="Cost per contractor" subtitle={`Closed jobs, ${periodLabel}`}>
          {loading ? (
            <Skeleton variant="rounded" height={160} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{contractorSort.sortLabel('contractor', 'Contractor')}</TableCell>
                    <TableCell align="right">{contractorSort.sortLabel('jobs', 'Jobs')}</TableCell>
                    <TableCell align="right">{contractorSort.sortLabel('actual_cost', 'Actual cost')}</TableCell>
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
        </CostPanel>
      </Box>

      {/* Recent costed jobs — the drill-down behind the aggregates. Jobs
          costing over 2× their category's average get an outlier flag. */}
      <CostPanel
        title="Recent costed jobs"
        subtitle={
          jobRows.length
            ? `Every close-out with a recorded cost, ${periodLabel} — showing ${visibleJobs.length} of ${jobRows.length}${
                outliersOnly ? ` outlier${jobRows.length === 1 ? '' : 's'}` : ''
              }. Click a column to sort.`
            : `Close-outs with a recorded cost, ${periodLabel}`
        }
        action={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {/* Outliers are the reason to open this table at all, so the
                filter states its own count rather than hiding it behind a click. */}
            <Tooltip
              title={
                outlierCount
                  ? 'Jobs billed at over twice their category average in this view'
                  : 'No job in this view is over twice its category average'
              }
            >
              <span>
                <Chip
                  size="small"
                  label={`Outliers (${outlierCount})`}
                  color={outliersOnly ? 'warning' : 'default'}
                  variant={outliersOnly ? 'filled' : 'outlined'}
                  disabled={!outlierCount && !outliersOnly}
                  onClick={() => setOutliersOnly((v) => !v)}
                />
              </span>
            </Tooltip>
            <ToggleButtonGroup
              value={jobsLimit}
              exclusive
              size="small"
              onChange={(_e, v) => v && setJobsLimit(v)}
            >
              <ToggleButton value={JOBS_PREVIEW_COUNT} sx={{ px: 2, textTransform: 'none' }}>
                Latest {JOBS_PREVIEW_COUNT}
              </ToggleButton>
              <ToggleButton value={Infinity} sx={{ px: 2, textTransform: 'none' }}>
                All ({jobRows.length})
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        }
      >
        {/* Table-local filters. These narrow the rows below only — the charts
            and KPIs keep the whole filtered period, so the category average an
            outlier is measured against does not move under the reader. */}
        {!loading && jobs.length > 0 && (
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="Category"
              value={jobsCategory}
              onChange={(e) => setJobsCategory(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All categories</MenuItem>
              {jobCategories.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Contractor"
              value={jobsContractor}
              onChange={(e) => setJobsContractor(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All contractors</MenuItem>
              {jobContractors.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Order"
              value={activeOrder}
              onChange={(e) => {
                const o = JOB_ORDERS.find((x) => x.label === e.target.value);
                if (o) jobsSort.setSort({ key: o.key, dir: o.dir });
              }}
              sx={{ minWidth: 170 }}
              helperText={activeOrder ? '' : 'sorted by a column'}
            >
              {JOB_ORDERS.map((o) => (
                <MenuItem key={o.label} value={o.label}>{o.label}</MenuItem>
              ))}
            </TextField>
            {jobsFiltered && (
              <Chip
                label="Clear table filters"
                size="small"
                variant="outlined"
                color="warning"
                onDelete={clearJobFilters}
                onClick={clearJobFilters}
                sx={{ alignSelf: 'center' }}
              />
            )}
          </Stack>
        )}

        {loading ? (
          <Skeleton variant="rounded" height={240} />
        ) : visibleJobs.length ? (
          // Capped so "All" on a year of history scrolls inside the panel
          // instead of pushing the rest of the page away.
          <TableContainer sx={{ maxHeight: jobsLimit === Infinity ? 520 : 'none' }}>
            <Table size="small" stickyHeader={jobsLimit === Infinity}>
              <TableHead>
                <TableRow>
                  <TableCell>{jobsSort.sortLabel('closed_at', 'Closed')}</TableCell>
                  <TableCell>{jobsSort.sortLabel('block', 'Block')}</TableCell>
                  <TableCell>{jobsSort.sortLabel('lift', 'Lift')}</TableCell>
                  <TableCell>{jobsSort.sortLabel('category', 'Category')}</TableCell>
                  <TableCell>{jobsSort.sortLabel('contractor', 'Contractor')}</TableCell>
                  <TableCell align="right">{jobsSort.sortLabel('actual_cost', 'Actual cost')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleJobs.map((j) => (
                  <TableRow key={j.id} hover>
                    <TableCell>{j.closed_at}</TableCell>
                    <TableCell>{j.block}</TableCell>
                    {/* Estate defects aren't tied to a lift — say so rather
                        than leaving the cell ambiguously blank. */}
                    <TableCell>{j.lift ?? '—'}</TableCell>
                    <TableCell>{j.category}</TableCell>
                    <TableCell>{j.contractor}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                        {isOutlier(j) && (
                          <Tooltip title={`Over 2× the ${j.category} average of ${fmtMoney(categoryAvg[j.category])}`}>
                            <Chip size="small" color="warning" label="Outlier" />
                          </Tooltip>
                        )}
                        <span>{fmtMoney(j.actual_cost)}</span>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Alert severity="info">
            {outliersOnly && !jobsCategory && !jobsContractor
              ? 'No outlier jobs in this view — every job is within twice its category average.'
              : jobsFiltered
                ? 'No jobs match these table filters. Clear them to see the rest of the period.'
                : 'No costed jobs match the current filters.'}
          </Alert>
        )}
      </CostPanel>

      {/* UC-004 → UC-011 live link: prompt (not auto-refresh) when a job is
          closed elsewhere, so charts don't move under the admin mid-read. */}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

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
