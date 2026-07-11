// UC-005 manager analytics dashboard: filter bar → AI alert cards → heatmap +
// trend + SLA gauge → contractor scorecard → priority queue, with CSV and
// PowerPoint export. Data comes from analyticsService (mocked until the
// Phase 3 backend endpoints land — see USE_MOCK there).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid2 as Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import { useAuth } from '../context/AuthContext';
import {
  parseInspectionsCsv,
  mergeHeatmap,
  mergeTrends,
  mergeSla,
} from '../utils/csvImport';
import HeatmapChart from '../components/analytics/HeatmapChart';
import TrendLineChart from '../components/analytics/TrendLineChart';
import SlaGauge from '../components/analytics/SlaGauge';
import ContractorScorecard from '../components/analytics/ContractorScorecard';
import AIAlertCard from '../components/analytics/AIAlertCard';
import PriorityQueue from '../components/analytics/PriorityQueue';
import { downloadCsv } from '../utils/csvDownload';
import {
  getHeatmap,
  getTrends,
  getSlaCompliance,
  getContractorScorecard,
  getPriorityQueue,
  getRecommendations,
  acceptRecommendation,
  dismissRecommendation,
  exportPptx,
} from '../services/analyticsService';

// Filter options — categories mirror the inspections.category CHECK constraint.
const BLOCKS = ['44A', '44B', '88B', '90C'];
const CATEGORIES = [
  'Structural', 'Electrical', 'Plumbing', 'Cleanliness', 'Lift',
  'Doors', 'Cabin', 'Safety', 'Landscaping', 'Pest', 'Other',
];

// Card wrapper shared by every dashboard section.
function Panel({ title, children, sx }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%', ...sx }}>
      {/* component="div": titles may contain a Chip (a div), which isn't valid
          inside the default h6 element. */}
      <Typography variant="subtitle1" component="div" fontWeight={700} sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Paper>
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
  const { profile } = useAuth();
  const isManager = profile?.role === 'manager';
  const [filters, setFilters] = useState({ block: '', category: '', from: '', to: '' });
  // Queue-only filters — narrow the priority queue without touching the charts.
  const [queueFilters, setQueueFilters] = useState({ priority: '', status: '' });
  const [heatmap, setHeatmap] = useState([]);
  const [trends, setTrends] = useState([]);
  const [sla, setSla] = useState(null);
  const [scorecard, setScorecard] = useState([]);
  const [queue, setQueue] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alertBusy, setAlertBusy] = useState(false);
  const [toast, setToast] = useState('');
  // What-if preview: imported CSV rows blended into the charts client-side.
  // null = normal (database) view. Nothing is written to the database.
  const [imported, setImported] = useState(null);
  // Shared preview view: all charts follow one switch on the banner —
  // combined | existing only | imported only.
  const [previewView, setPreviewView] = useState('all');
  const fileInputRef = useRef(null);

  // Charts render these — merged with the import in preview mode. The charts
  // also receive the imported portion separately so they can visually mark
  // what's real vs simulated (ring on heatmap cells, dashed trend line,
  // before → after on the gauge).
  // Imported rows alone, aggregated to heatmap shape [{ block, category, count }].
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
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseInspectionsCsv(reader.result);
        setImported(rows);
        setPreviewView('all'); // fresh import always starts on the combined view
        setToast(`Previewing ${rows.length} imported row${rows.length === 1 ? '' : 's'} — charts updated.`);
      } catch (err) {
        setToast(err.message);
      }
    };
    reader.onerror = () => setToast('Could not read that file — try again.');
    reader.readAsText(file);
  }

  // Re-fetch everything whenever a filter changes (phase task 5.9).
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    try {
      const [hm, tr, sl, sc, rec] = await Promise.all([
        getHeatmap(params),
        getTrends(params),
        getSlaCompliance(params),
        getContractorScorecard(params),
        getRecommendations(),
      ]);
      setHeatmap(hm.data);
      setTrends(tr.data);
      setSla(sl);
      setScorecard(sc.data);
      setAlerts(rec.data);
    } catch {
      setToast('Could not load dashboard data — check the backend is running, then change a filter to retry.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (isManager) fetchAll();
  }, [fetchAll, isManager]);

  // The queue re-fetches on its own filters too (priority/status), on top of
  // the shared dashboard filters.
  useEffect(() => {
    if (!isManager) return;
    const params = Object.fromEntries(
      Object.entries({ ...filters, ...queueFilters }).filter(([, v]) => v)
    );
    getPriorityQueue(params)
      .then((pq) => setQueue(pq.data))
      .catch(() => setQueue([]));
  }, [filters, queueFilters, isManager]);

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  // Accept/dismiss endpoints are UC-006 (not built yet) — surface a toast
  // instead of crashing until they land.
  async function handleAccept(id) {
    setAlertBusy(true);
    try {
      await acceptRecommendation(id);
      setAlerts((a) => a.filter((x) => x.id !== id));
      setToast('Alert accepted — preventive maintenance record created.');
    } catch {
      setToast('Accept needs the UC-006 backend — coming soon.');
    }
    setAlertBusy(false);
  }

  async function handleDismiss(id) {
    setAlertBusy(true);
    try {
      await dismissRecommendation(id);
      setAlerts((a) => a.filter((x) => x.id !== id));
      setToast('Alert dismissed.');
    } catch {
      setToast('Dismiss needs the UC-006 backend — coming soon.');
    }
    setAlertBusy(false);
  }

  async function handlePptxExport() {
    try {
      const { pptx_url } = await exportPptx(
        ['heatmap', 'trends', 'sla_gauge', 'contractor_scorecard'],
        filters
      );
      window.open(pptx_url, '_blank');
    } catch (err) {
      setToast(err.message);
    }
  }

  // Non-managers: keep the untouched resident home placeholder.
  if (!isManager) {
    return <ResidentPlaceholder />;
  }

  if (loading && !sla) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 1200, mx: 'auto' }}>
      {/* Header row: title + export actions */}
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
        <Stack direction="row" spacing={1}>
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

      {/* Filter bar (5.9) — block / category / date range */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Block</InputLabel>
            <Select label="Block" value={filters.block} onChange={setFilter('block')}>
              <MenuItem value="">All blocks</MenuItem>
              {BLOCKS.map((b) => (
                <MenuItem key={b} value={b}>{b}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Category</InputLabel>
            <Select label="Category" value={filters.category} onChange={setFilter('category')}>
              <MenuItem value="">All categories</MenuItem>
              {CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="From"
            type="date"
            value={filters.from}
            onChange={setFilter('from')}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label="To"
            type="date"
            value={filters.to}
            onChange={setFilter('to')}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
      </Paper>

      {/* What-if preview banner — orange to match the preview accent used on
          the charts (rings, dashed line, chips), with a white pop-out Clear
          button. Distinct from both brand-red data and the amber alert cards. */}
      {imported && (
        <Paper
          elevation={4}
          sx={{
            mb: 3,
            px: 2.5,
            py: 1.75,
            borderRadius: 2,
            bgcolor: 'warning.dark',
            color: 'common.white',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <FileUploadOutlinedIcon />
          <Box sx={{ flexGrow: 1, minWidth: 240 }}>
            <Typography fontWeight={700} lineHeight={1.3}>
              What-if preview active — {imported.length} imported row
              {imported.length === 1 ? '' : 's'}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              Blended into the heatmap, trend and SLA gauge. Not saved — exports still use real data.
            </Typography>
          </Box>
          <Button
            variant="contained"
            disableElevation
            onClick={clearPreview}
            sx={{
              bgcolor: 'common.white',
              color: 'warning.dark',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              px: 2.5,
              '&:hover': { bgcolor: 'grey.100' },
            }}
          >
            ✕ Clear preview
          </Button>
        </Paper>
      )}

      {/* AI risk alerts (5.12/5.13) above the heatmap */}
      {alerts.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {alerts.map((a) => (
            <AIAlertCard
              key={a.id}
              alert={a}
              busy={alertBusy}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
            />
          ))}
        </Stack>
      )}

      {/* Preview view switch — its own bar right above the charts it controls:
          one switch flips the heatmap, trend and SLA gauge together. */}
      {imported && (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
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
        </Stack>
      )}

      {/* Charts row: heatmap + trend + SLA gauge */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Panel title={<>Issues by block × category{previewChip}</>}>
            {displayHeatmap.length ? (
              <Box sx={{ height: 300 }}>
                <HeatmapChart
                  data={displayHeatmap}
                  importedMap={showImported && imported ? importedMap : null}
                />
              </Box>
            ) : (
              <Alert severity="info">No records match the current filters.</Alert>
            )}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, sm: 7, md: 3.5 }}>
          <Panel title={<>Issue trend{previewChip}</>}>
            <Box sx={{ height: 300 }}>
              <TrendLineChart
                data={showExisting ? trends : null}
                imported={showImported ? importedTrend : null}
              />
            </Box>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, sm: 5, md: 2.5 }}>
          <Panel title={<>SLA compliance{previewChip}</>}>
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
          </Panel>
        </Grid>
      </Grid>

      {/* Contractor scorecard (5.13a) */}
      <Box sx={{ mb: 3 }}>
        <Panel title="Contractor scorecard">
          <ContractorScorecard rows={scorecard} />
        </Panel>
      </Box>

      {/* Priority queue (5.3) — with its own priority/status narrowing */}
      <Panel title="Priority queue">
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
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
        </Stack>
        {queue.length ? (
          <PriorityQueue rows={queue} />
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
