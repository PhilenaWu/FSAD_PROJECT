// UC-005 manager analytics dashboard: filter bar → AI alert cards → heatmap +
// trend + SLA gauge → contractor scorecard → priority queue, with CSV and
// PowerPoint export. Data comes from analyticsService (mocked until the
// Phase 3 backend endpoints land — see USE_MOCK there).
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
  Tooltip,
  Typography,
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import SlideshowOutlinedIcon from '@mui/icons-material/SlideshowOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import { useAuth } from '../context/AuthContext';
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
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
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

  // Re-fetch everything whenever a filter changes (phase task 5.9).
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
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
    setLoading(false);
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
    getPriorityQueue(params).then((pq) => setQueue(pq.data));
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

      {/* Charts row: heatmap + trend + SLA gauge */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Panel title="Issues by block × category">
            {heatmap.length ? (
              <Box sx={{ height: 300 }}>
                <HeatmapChart data={heatmap} />
              </Box>
            ) : (
              <Alert severity="info">No records match the current filters.</Alert>
            )}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, sm: 7, md: 3.5 }}>
          <Panel title="Issue trend">
            <Box sx={{ height: 300 }}>
              <TrendLineChart data={trends} />
            </Box>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, sm: 5, md: 2.5 }}>
          <Panel title="SLA compliance">
            <Box sx={{ height: 300 }}>{sla && <SlaGauge sla={sla} />}</Box>
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
