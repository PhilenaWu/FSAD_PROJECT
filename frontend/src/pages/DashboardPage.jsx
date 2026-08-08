// UC-005 manager analytics dashboard: KPI row → filter bar → AI alert cards →
// heatmap + trend + SLA gauge → contractor scorecard → priority queue, with
// CSV / PowerPoint export and a client-side CSV what-if preview.
// Filters live in the URL query string so a filtered view is bookmarkable and
// shareable (e.g. /dashboard?block=44A&category=Lift).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid2 as Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import SlideshowOutlinedIcon from '@mui/icons-material/SlideshowOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CloseIcon from '@mui/icons-material/Close';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  parseInspectionsCsv,
  mergeHeatmap,
  mergeTrends,
  mergeSla,
} from '../utils/csvImport';
import { bucketTrend } from '../utils/trendBuckets';
import KpiRow from '../components/analytics/KpiRow';
import HeatmapChart from '../components/analytics/HeatmapChart';
import TrendLineChart from '../components/analytics/TrendLineChart';
import SlaGauge from '../components/analytics/SlaGauge';
import ContractorScorecard from '../components/analytics/ContractorScorecard';
import AIAlertCard from '../components/analytics/AIAlertCard';
import PriorityQueue from '../components/analytics/PriorityQueue';
import { downloadCsv } from '../utils/csvDownload';
import {
  getFilterOptions,
  getSummary,
  getHeatmap,
  getTrends,
  getSlaCompliance,
  getContractorScorecard,
  getPriorityQueue,
  getRecommendations,
  acceptRecommendation,
  dismissRecommendation,
  runAnalysis,
  exportPptx,
} from '../services/analyticsService';

// `section` filters to inspections carrying a defect in that section of the
// paper spot-check form (HLD §7.2) — the client's "which part of the lift
// fails most" question.
const FILTER_KEYS = ['block', 'category', 'section', 'from', 'to'];

// How many AI risk alerts sit on the dashboard before the rest are folded away.
const ALERT_PREVIEW_COUNT = 3;

// CSV import guards — a mis-picked huge file must not freeze the tab.
const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_ROWS = 5000;

// The what-if preview survives an accidental refresh via sessionStorage —
// still session-only and never written to the database ("Clear" also removes
// it here). A corrupt or missing entry just means no preview.
const PREVIEW_STORAGE_KEY = 'dashboard-whatif-preview';

function loadStoredPreview() {
  try {
    const rows = JSON.parse(sessionStorage.getItem(PREVIEW_STORAGE_KEY));
    return Array.isArray(rows) && rows.length ? rows : null;
  } catch {
    return null;
  }
}

// Card wrapper shared by every dashboard section. `subtitle` states the time
// window the panel covers, so its numbers can't be misread against the KPI
// tiles (which use their own 30-day windows).
function Panel({ title, subtitle, children, sx }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%', ...sx }}>
      {/* component="div": titles may contain a Chip (a div), which isn't valid
          inside the default h6 element. */}
      <Typography variant="subtitle1" component="div" fontWeight={700}>
        {title}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2, minHeight: 18 }}>
        {subtitle}
      </Typography>
      {children}
    </Paper>
  );
}

// Shown while /api/users/me is still in flight. Without it the page rendered
// ResidentPlaceholder during the gap, so a manager saw an empty dashed box for
// as long as the profile took to load.
function ProfileLoading() {
  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, display: 'flex', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>
  );
}

// Shown when /api/users/me failed. The role is unknown, so the dashboard cannot
// be rendered — but "we could not load your profile" is a different statement
// from "you are not a manager", and the placeholder said the second one for
// both. Suspended and pending accounts never reach here: RoleLayout intercepts
// those codes and renders its own explanation instead of the routed page.
function ProfileError() {
  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 720, mx: 'auto' }}>
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => window.location.reload()}>
            Retry
          </Button>
        }
      >
        Could not load your profile, so the dashboard cannot tell which role you
        are signed in as. Check your connection and try again.
      </Alert>
    </Box>
  );
}

// Residents land on /dashboard too, but analytics is manager-only (the API
// 403s other roles). They keep the original empty placeholder — the resident
// home page is owned by another use case and stays untouched.
function ResidentPlaceholder() {
  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <Box
        sx={{
          border: '2px dashed',
          borderColor: 'divider',
          borderRadius: 2,
          minHeight: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Stack spacing={1} alignItems="center">
          <GridViewOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
          <Typography color="text.secondary">page content area</Typography>
        </Stack>
      </Box>
    </Box>
  );
}

export default function DashboardPage() {
  const { user, profile, profileLoading } = useAuth();
  const { socket } = useSocket();
  const isManager = profile?.role === 'manager';

  // A null profile means one of three things and they are not interchangeable:
  // the fetch is still in flight, the fetch failed, or this genuinely is not a
  // manager. Treating all three as "not a manager" turned any /api/users/me
  // failure into a blank dashed panel with no error and no retry — the
  // dashboard simply looked empty. profileLoading is derived in AuthContext;
  // a failure is the remaining case where a signed-in user still has no
  // profile row loaded.
  const profileFailed = Boolean(user) && !profile && !profileLoading;

  // Filters are the URL query string (bookmarkable/shareable dashboard state).
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) ?? ''])),
    [searchParams]
  );
  const dateRangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);

  // Queue-only controls — narrow the priority queue without touching the charts.
  const [queueFilters, setQueueFilters] = useState({ priority: '', status: '' });
  const [queueLimit, setQueueLimit] = useState(10); // 10 = triage view, Infinity = all

  // Dropdown options come from the database (distinct blocks/categories with
  // records) — fetched once, nothing hardcoded.
  const [filterOptions, setFilterOptions] = useState({ blocks: [], categories: [], sections: [] });
  const [summary, setSummary] = useState(null);
  const [heatmap, setHeatmap] = useState([]);
  const [trends, setTrends] = useState([]);
  const [sla, setSla] = useState(null);
  const [scorecard, setScorecard] = useState([]);
  const [queue, setQueue] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);
  const [toast, setToast] = useState('');

  // What-if preview: imported CSV rows blended into the charts client-side.
  // null = normal (database) view. Nothing is written to the database.
  const [imported, setImported] = useState(loadStoredPreview);
  // Shared preview view: all charts follow one switch — combined | existing | imported.
  const [previewView, setPreviewView] = useState('all');
  const fileInputRef = useRef(null);

  // Charts render these — merged with the import in preview mode. The charts
  // also receive the imported portion separately so they can visually mark
  // what's real vs simulated (ring on heatmap cells, dashed trend line,
  // before → after on the gauge).
  const importedHeatmap = useMemo(
    () => (imported ? mergeHeatmap([], imported) : []),
    [imported]
  );
  const displayHeatmap = useMemo(() => {
    if (!imported) return heatmap;
    if (previewView === 'existing') return heatmap;
    if (previewView === 'imported') return importedHeatmap;
    return mergeHeatmap(heatmap, imported);
  }, [heatmap, imported, importedHeatmap, previewView]);
  const displaySla = useMemo(
    () => (imported && sla ? mergeSla(sla, imported) : sla),
    [sla, imported]
  );
  // { "block|category": importedCount } — which heatmap cells to ring.
  const importedMap = useMemo(() => {
    if (!imported) return null;
    const map = {};
    for (const r of imported) {
      const key = `${r.block}|${r.category}`;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [imported]);
  // [{ date, count }] — the dashed "Imported (preview)" trend series.
  const importedTrend = useMemo(() => {
    if (!imported) return null;
    return mergeTrends([], imported);
  }, [imported]);
  // The trend line buckets by day / week / month depending on how much history
  // is in view, so the panel subtitle has to say which one it settled on.
  const trendGranularity = useMemo(
    () => bucketTrend([trends, importedTrend ?? []]).granularity,
    [trends, importedTrend]
  );
  // Alerts arrive newest-first from the API, so the preview is a plain slice.
  const visibleAlerts = useMemo(
    () => (alertsExpanded ? alerts : alerts.slice(0, ALERT_PREVIEW_COUNT)),
    [alerts, alertsExpanded]
  );
  // SLA of the imported rows alone; null when the import has no resolved rows.
  const importedSla = useMemo(() => {
    if (!imported || !sla) return null;
    const resolved = imported.filter((r) => r.resolution_time_hours != null);
    if (!resolved.length) return null;
    return mergeSla(
      { compliant_count: 0, total_resolved: 0, sla_percentage: 0, sla_threshold_hrs: sla.sla_threshold_hrs },
      imported
    );
  }, [imported, sla]);

  // Which dataset each chart shows under the current preview view. With no
  // import active the view switch is irrelevant — always show the real data.
  const showExisting = !imported || previewView !== 'imported';
  const showImported = Boolean(imported) && previewView !== 'existing';

  function clearPreview() {
    setImported(null);
    setPreviewView('all'); // stale "Imported only" must not linger past the import
    sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
  }

  // Panel-title chip marking charts that currently include preview data.
  const previewChip = imported ? (
    <Chip
      label="preview"
      size="small"
      sx={{ ml: 1, bgcolor: 'warning.dark', color: 'common.white', fontWeight: 600 }}
    />
  ) : null;

  function handleCsvImport(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setToast('File too large — imports are capped at 1 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseInspectionsCsv(reader.result);
        if (rows.length > MAX_IMPORT_ROWS) {
          throw new Error(`Too many rows (${rows.length}) — imports are capped at ${MAX_IMPORT_ROWS}.`);
        }
        setImported(rows);
        setPreviewView('all'); // fresh import always starts on the combined view
        try {
          sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(rows));
        } catch {
          // Quota exceeded — the preview still works, it just won't survive a refresh.
        }
        setToast(`Previewing ${rows.length} imported row${rows.length === 1 ? '' : 's'} — charts updated.`);
      } catch (err) {
        setToast(err.message);
      }
    };
    reader.onerror = () => setToast('Could not read that file — try again.');
    reader.readAsText(file);
  }

  // Re-fetch everything whenever a filter changes (phase task 5.9).
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
      const [sm, hm, tr, sl, sc, rec] = await Promise.all([
        getSummary(params),
        getHeatmap(params),
        getTrends(params),
        getSlaCompliance(params),
        getContractorScorecard(params),
        getRecommendations(),
      ]);
      if (isStale()) return;
      setSummary(sm);
      setHeatmap(hm.data);
      setTrends(tr.data);
      setSla(sl);
      setScorecard(sc.data);
      setAlerts(rec.data);
    } catch {
      if (isStale()) return;
      setFetchFailed(true);
    } finally {
      // A superseded request must not clear the spinner the newer one raised.
      if (!isStale()) setLoading(false);
    }
  }, [filters, dateRangeInvalid]);

  useEffect(() => {
    if (!isManager) return undefined;
    let superseded = false;
    fetchAll(() => superseded);
    return () => {
      superseded = true;
    };
  }, [fetchAll, isManager]);

  // Filter dropdown options — once per visit; failures just leave them empty.
  useEffect(() => {
    if (!isManager) return;
    getFilterOptions()
      .then(setFilterOptions)
      .catch(() => {});
  }, [isManager]);

  // The queue re-fetches on its own filters too (priority/status), on top of
  // the shared dashboard filters. Declared before the live-refresh effect
  // below, which calls it: fetchAll deliberately does not cover the queue (it
  // has extra filters), which is why a live update used to repaint every panel
  // except this one.
  const fetchQueue = useCallback(() => {
    if (!isManager || dateRangeInvalid) return;
    const params = Object.fromEntries(
      Object.entries({ ...filters, ...queueFilters }).filter(([, v]) => v)
    );
    getPriorityQueue(params)
      .then((pq) => setQueue(pq.data))
      .catch(() => setQueue([]));
  }, [filters, queueFilters, isManager, dateRangeInvalid]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Live refresh. The backend pushes `status_update` to manager-room on every
  // assign, rectify and close (HLD §10), so the dashboard must not sit stale
  // while records move underneath it — every other role's landing page already
  // updates live. Coalesced on a short timer because a burst of transitions
  // would otherwise trigger a re-fetch per event.
  // `cv_alert` as well as `status_update`: a high-confidence CV detection
  // auto-creates a record without any status transition, so listening only for
  // status_update left a brand-new high-priority ticket invisible until reload.
  useEffect(() => {
    if (!isManager || !socket) return;
    let timer;
    const onLiveChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fetchAll();
        fetchQueue();
      }, 1500);
    };
    socket.on('status_update', onLiveChange);
    socket.on('cv_alert', onLiveChange);
    return () => {
      clearTimeout(timer);
      socket.off('status_update', onLiveChange);
      socket.off('cv_alert', onLiveChange);
    };
  }, [socket, isManager, fetchAll, fetchQueue]);

  // Writing a filter updates the URL (replace, so back doesn't step through
  // every keystroke); empty values are dropped to keep the URL clean.
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

  // Small ✕ inside a filter control, shown only while it has a value.
  // Positioned before the select's dropdown arrow.
  const clearAdornment = (key) =>
    filters[key] ? (
      <InputAdornment position="end" sx={{ mr: 2 }}>
        <IconButton
          size="small"
          edge="end"
          aria-label={`Clear ${key} filter`}
          onClick={() => clearFilter(key)}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </InputAdornment>
    ) : null;

  // UC-006 alert actions. Accept opens a preventive-maintenance record and
  // removes the card; on error, surface the backend's message.
  async function handleAccept(id) {
    setAlertBusy(true);
    try {
      await acceptRecommendation(id);
      setAlerts((a) => a.filter((x) => x.id !== id));
      setToast('Alert accepted — preventive maintenance record created.');
    } catch (err) {
      setToast(err.response?.data?.message ?? err.message);
    }
    setAlertBusy(false);
  }

  async function handleDismiss(id) {
    setAlertBusy(true);
    try {
      await dismissRecommendation(id);
      setAlerts((a) => a.filter((x) => x.id !== id));
      setToast('Alert dismissed.');
    } catch (err) {
      setToast(err.response?.data?.message ?? err.message);
    }
    setAlertBusy(false);
  }

  // Manager-triggered "run the nightly analysis now" (HLD §6.4 / UC-006). Runs
  // the velocity scan on the backend, then refreshes so new alert cards appear.
  async function handleRunAnalysis() {
    setToast('Running AI analysis…');
    try {
      const result = await runAnalysis();
      setToast(`Analysis complete — ${result.alerts_generated} alert(s) generated.`);
      fetchAll();
    } catch (err) {
      setToast(err.response?.data?.message ?? err.message);
    }
  }

  async function handlePptxExport() {
    try {
      const { pptx_url } = await exportPptx(
        ['heatmap', 'trends', 'sla_gauge', 'contractor_scorecard'],
        filters
      );
      window.open(pptx_url, '_blank');
    } catch (err) {
      setToast(err.response?.data?.message ?? err.message);
    }
  }

  // Last ~14 points of the same daily series the trend chart plots, for the
  // "Reports filed" KPI tile's sparkline. undefined (not []) when there's no
  // data yet, so the tile skips rendering an empty chart rather than a flat line.
  // Computed before the resident early-return below — hooks must run
  // unconditionally on every render.
  const reportsSparkline = useMemo(
    () => (trends.length ? trends.slice(-14).map((t) => t.count) : undefined),
    [trends]
  );

  // Order matters: the placeholder is only correct once the role is actually
  // known. Anything else here is a lie about why the page is empty.
  if (profileLoading) {
    return <ProfileLoading />;
  }
  if (profileFailed) {
    return <ProfileError />;
  }

  // Non-managers: keep the untouched resident home placeholder.
  if (!isManager) {
    return <ResidentPlaceholder />;
  }

  const queueRows = queueLimit === Infinity ? queue : queue.slice(0, queueLimit);
  const chartSkeleton = <Skeleton variant="rounded" height={300} />;

  // Human-readable time window for the chart panel subtitles — the charts
  // cover all records unless the From/To filters narrow them, unlike the
  // "Reports filed" KPI which always uses its own 30-day windows.
  const periodLabel =
    filters.from || filters.to
      ? `${filters.from || 'start'} → ${filters.to || 'today'}`
      : 'all time';

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 1200, mx: 'auto' }}>
      {/* Header row: title + actions */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Typography variant="h5" fontWeight={700}>
          Analytics Dashboard
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Tooltip title="Run the AI velocity analysis now instead of waiting for the nightly job.">
            <Button
              variant="text"
              startIcon={<AutoAwesomeOutlinedIcon />}
              onClick={handleRunAnalysis}
            >
              Run AI analysis
            </Button>
          </Tooltip>
          {/* What-if preview: blend a CSV into the charts client-side. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={handleCsvImport}
          />
          <Tooltip title="Preview how the charts change with extra rows (block,category[,date][,resolution_time_hours]). Nothing is saved.">
            <Button
              variant="outlined"
              startIcon={<FileUploadOutlinedIcon />}
              onClick={() => fileInputRef.current?.click()}
            >
              Import CSV
            </Button>
          </Tooltip>
          {/* ANA-T05: disabled with a tooltip when the filter result is empty.
              span wrapper — MUI tooltips need a focusable child when disabled. */}
          <Tooltip title={queue.length ? '' : 'No records match the current filters — nothing to export.'}>
            <span>
              <Button
                variant="outlined"
                startIcon={<FileDownloadOutlinedIcon />}
                disabled={!queue.length}
                onClick={() => downloadCsv(queue, 'priority-queue.csv')}
              >
                Export CSV
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<SlideshowOutlinedIcon />}
            onClick={handlePptxExport}
          >
            Export to PowerPoint
          </Button>
        </Stack>
      </Stack>

      {/* Fetch failure — persistent banner with a direct retry. */}
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
          Could not load dashboard data — check that the backend is running.
        </Alert>
      )}

      {/* KPI summary row — leads with what changed, not just what is. */}
      {summary ? (
        <KpiRow summary={summary} trendSparkline={reportsSparkline} />
      ) : (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[0, 1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 6, md: 3 }}>
              <Skeleton variant="rounded" height={96} />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Filter bar (5.9) — block / category / date range, persisted in the URL */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        {/* wrap: five controls overflow a tablet-width row otherwise. */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
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
          {/* Paper-form section (A/B/C). Hidden until the checklist template
              is seeded, so the bar never shows an empty control. */}
          {filterOptions.sections.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel>Form section</InputLabel>
              <Select
                label="Form section"
                value={filters.section}
                onChange={setFilter('section')}
                endAdornment={clearAdornment('section')}
              >
                <MenuItem value="">All sections</MenuItem>
                {filterOptions.sections.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
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
        </Stack>
      </Paper>

      {/* AI risk alerts (5.12/5.13) above the heatmap. Only the newest few are
          shown: the alerts are a prompt to act, and a wall of twenty pushes
          every chart below the fold. The header states how many are waiting so
          the count is never hidden by the truncation. */}
      {alerts.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 1 }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                AI risk alerts
              </Typography>
              <Chip size="small" color="warning" label={`${alerts.length} active`} />
            </Stack>
            {alerts.length > ALERT_PREVIEW_COUNT && (
              <Button
                size="small"
                onClick={() => setAlertsExpanded((v) => !v)}
                endIcon={alertsExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              >
                {alertsExpanded ? 'Show fewer' : `View all ${alerts.length}`}
              </Button>
            )}
          </Stack>

          <Stack spacing={1.5}>
            {visibleAlerts.map((a) => (
              <AIAlertCard
                key={a.id}
                alert={a}
                busy={alertBusy}
                onAccept={handleAccept}
                onDismiss={handleDismiss}
              />
            ))}
          </Stack>

          {!alertsExpanded && alerts.length > ALERT_PREVIEW_COUNT && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Showing the {ALERT_PREVIEW_COUNT} most recent of {alerts.length}. Accepting or
              dismissing one brings the next into view.
            </Typography>
          )}
        </Box>
      )}

      {/* Preview control bar — appears only while a CSV preview is active,
          right above the charts it controls. One row in the chart-view style:
          the view switch, the preview status, and the Clear button. */}
      {imported && (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 2 }}
        >
          <Typography variant="subtitle2" fontWeight={700} color="warning.dark">
            Chart view:
          </Typography>
          <ToggleButtonGroup
            value={previewView}
            exclusive
            size="small"
            onChange={(_e, v) => v && setPreviewView(v)}
            sx={{
              bgcolor: 'background.paper',
              '& .MuiToggleButton-root': {
                px: 2,
                textTransform: 'none',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                '&.Mui-selected': {
                  bgcolor: 'warning.dark',
                  color: 'common.white',
                  '&:hover': { bgcolor: 'warning.main' },
                },
              },
            }}
          >
            <ToggleButton value="all">Combined</ToggleButton>
            <ToggleButton value="existing">Existing only</ToggleButton>
            <ToggleButton value="imported">Imported only</ToggleButton>
          </ToggleButtonGroup>
          <Stack sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700} color="warning.dark" noWrap>
              What-if preview — {imported.length} imported row{imported.length === 1 ? '' : 's'}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              Not saved to the database; exports use real data.
            </Typography>
          </Stack>
          <Button
            size="small"
            variant="outlined"
            onClick={clearPreview}
            sx={{
              bgcolor: 'background.paper',
              color: 'warning.dark',
              borderColor: 'warning.dark',
              fontWeight: 600,
              textTransform: 'none',
              whiteSpace: 'nowrap',
              px: 2,
              '&:hover': { borderColor: 'warning.main', bgcolor: 'warning.light', color: 'common.white' },
            }}
          >
            ✕ Clear preview
          </Button>
        </Stack>
      )}

      {/* Charts row: heatmap + trend + SLA gauge */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Panel
            title={<>Issues by block × category{previewChip}</>}
            subtitle={`All reports, ${periodLabel}`}
          >
            {loading ? (
              chartSkeleton
            ) : displayHeatmap.length ? (
              <Box sx={{ height: 300 }}>
                <HeatmapChart
                  data={displayHeatmap}
                  importedMap={showImported ? importedMap : null}
                />
              </Box>
            ) : (
              <Alert severity="info">No records match the current filters.</Alert>
            )}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, sm: 7, md: 3.5 }}>
          <Panel title={<>Issue trend{previewChip}</>} subtitle={`Reports per ${trendGranularity}, ${periodLabel}`}>
            {loading ? (
              chartSkeleton
            ) : (showExisting && trends.length) || (showImported && importedTrend?.length) ? (
              <Box sx={{ height: 300 }}>
                <TrendLineChart
                  data={showExisting ? trends : null}
                  imported={showImported ? importedTrend : null}
                />
              </Box>
            ) : (
              // A6: an empty result renders its own info state, never a bare axis.
              <Alert severity="info">No records match the current filters.</Alert>
            )}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, sm: 5, md: 2.5 }}>
          <Panel title={<>SLA compliance{previewChip}</>} subtitle={`Closed reports, ${periodLabel}`}>
            {loading ? (
              chartSkeleton
            ) : (
              <Box sx={{ height: 300 }}>
                {imported && previewView === 'imported' ? (
                  importedSla ? (
                    <SlaGauge sla={importedSla} />
                  ) : (
                    <Alert severity="info">
                      No resolved rows in the import — SLA needs resolution_time_hours values.
                    </Alert>
                  )
                ) : imported && previewView === 'existing' ? (
                  sla && <SlaGauge sla={sla} />
                ) : (
                  displaySla && <SlaGauge sla={displaySla} baseline={imported ? sla : null} />
                )}
              </Box>
            )}
          </Panel>
        </Grid>
      </Grid>

      {/* Contractor scorecard (5.13a) */}
      <Box sx={{ mb: 3 }}>
        <Panel title="Contractor scorecard" subtitle={`Assigned jobs, ${periodLabel}`}>
          {loading ? (
            <Skeleton variant="rounded" height={160} />
          ) : scorecard.length ? (
            <ContractorScorecard rows={scorecard} />
          ) : (
            // A6: no assigned jobs in this view — say so instead of an empty table.
            <Alert severity="info">No assigned jobs match the current filters.</Alert>
          )}
        </Panel>
      </Box>

      {/* Priority queue (5.3) — Top 10 triage view by default */}
      <Panel title="Priority queue" subtitle={`Open records ranked by urgency, ${periodLabel}`}>
        <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Priority</InputLabel>
            <Select
              label="Priority"
              value={queueFilters.priority}
              onChange={(e) => setQueueFilters((f) => ({ ...f, priority: e.target.value }))}
            >
              <MenuItem value="">All priorities</MenuItem>
              {['Critical', 'High', 'Medium', 'Low'].map((p) => (
                <MenuItem key={p} value={p}>{p}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={queueFilters.status}
              onChange={(e) => setQueueFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <MenuItem value="">All open statuses</MenuItem>
              {['Open', 'Pending Assignment', 'Assigned', 'Acknowledged', 'On Hold', 'Rectified'].map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <ToggleButtonGroup
            value={queueLimit}
            exclusive
            size="small"
            onChange={(_e, v) => v && setQueueLimit(v)}
          >
            <ToggleButton value={10} sx={{ px: 2, textTransform: 'none' }}>
              Top 10
            </ToggleButton>
            <ToggleButton value={Infinity} sx={{ px: 2, textTransform: 'none' }}>
              All ({queue.length})
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {loading ? (
          <Skeleton variant="rounded" height={240} />
        ) : queueRows.length ? (
          <PriorityQueue rows={queueRows} />
        ) : (
          <Alert severity="info">No open records match the current filters.</Alert>
        )}
      </Panel>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast('')}
        message={toast}
      />
    </Box>
  );
}
