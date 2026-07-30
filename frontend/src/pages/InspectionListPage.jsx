// UC-002 manager triage queue. Open inspections from GET /api/inspections,
// most urgent first (AI priority score). Status-group tabs ("Needs action",
// "In progress", "Awaiting endorsement") answer the question a manager opens
// the queue to ask; category/block narrow within a tab. All of it lives in the
// URL so the dashboard heatmap can drill through to a pre-filtered queue and a
// filtered view stays bookmarkable. Row click opens the detail/triage view.
// Closed records are archived and live on /inspections/history instead.
// Inspectors also read this endpoint (backend allows it read-only) to review
// completed work before the manager's joint close — always filtered to
// status=Rectified and without the tabs.
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../services/api';
import { getFilterOptions } from '../services/analyticsService';
import { priorityDisplay } from '../utils/priorityDisplay';
import { CATEGORIES, QUEUE_TABS } from '../utils/inspectionOptions';
import ManualReviewQueue from '../components/cv/ManualReviewQueue';

// The CV manual-review queue sits alongside the status-group tabs — it's
// another bucket of work to look at, just sourced from cv_detections.
const REVIEW_TAB = 'review';

export default function InspectionListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isInspector = profile?.role === 'inspector';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // Background refetch (socket-driven) — shows a thin bar, never the spinner.
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Filters live in the URL, so the dashboard heatmap can drill through to a
  // pre-filtered queue (/inspections?block=44A&category=Lift) and so a filtered
  // view stays bookmarkable — same pattern as DashboardPage / AdminCostPage.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'all';
  const category = searchParams.get('category') ?? '';
  const block = searchParams.get('block') ?? '';
  // Set by the UC-005 contractor-scorecard drill-through; cleared by its chip.
  const contractor = searchParams.get('contractor') ?? '';
  const overdue = searchParams.get('overdue') === 'true';

  // The tab owns the status filter: each one maps to a comma-separated list the
  // API expands with `status = ANY(...)`. Inspectors bypass the tabs entirely —
  // they only ever see completed work awaiting their review.
  const status = isInspector
    ? 'Rectified'
    : (QUEUE_TABS.find((t) => t.key === tab)?.statuses ?? []).join(',');

  // Replace (not push) so back doesn't step through every dropdown change;
  // empty values are dropped to keep the URL clean.
  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };
  const setFilter = (key) => (e) => setParam(key, e.target.value);
  // 'all' is the default, so it lives as an absent param rather than ?tab=all.
  const setTab = (key) => setParam('tab', key === 'all' ? '' : key);

  // `silent` refetches leave `loading` alone: swapping the whole table for a
  // spinner on every socket event would blink the manager's place away. They
  // drive the thin progress bar above the table instead.
  const fetchRows = useCallback(
    (silent = false) => {
      // The manual-review tab renders its own component with its own fetch.
      if (tab === REVIEW_TAB) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      const params = {};
      if (status) params.status = status;
      if (category) params.category = category;
      if (block) params.block = block;
      if (contractor) params.contractor = contractor;
      if (overdue) params.overdue = 'true';
      api
        .get('/api/inspections', { params })
        .then((res) => {
          setRows(res.data.data);
          setLoadError(false);
        })
        .catch(() => setLoadError(true))
        .finally(() => {
          if (silent) setRefreshing(false);
          else setLoading(false);
        });
    },
    [tab, status, category, block, contractor, overdue]
  );

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Live refresh. The backend pushes `status_update` to manager-room on every
  // transition — including a newly filed spot-check — so the queue must not sit
  // stale while records move underneath it. Coalesced on a short timer because
  // a burst of transitions would otherwise trigger a re-fetch per event.
  // Managers only: nobody else is in manager-room, so the subscription would
  // never fire for an inspector.
  const { socket } = useSocket();
  useEffect(() => {
    if (isInspector || !socket) return undefined;
    let timer;
    const onStatusUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchRows(true), 1500);
    };
    socket.on('status_update', onStatusUpdate);
    return () => {
      clearTimeout(timer);
      socket.off('status_update', onStatusUpdate);
    };
  }, [socket, isInspector, fetchRows]);

  // Block options come from the analytics filter-options endpoint (manager-only,
  // same gate as this page). Deriving them from `rows` collapsed the dropdown to
  // a single value the moment a block filter applied — so a manager who drilled
  // in from the heatmap could not switch to another block without clearing first.
  const [blockOptions, setBlockOptions] = useState([]);
  useEffect(() => {
    getFilterOptions()
      .then((o) => setBlockOptions(o.blocks ?? []))
      .catch(() => {}); // dropdown just stays empty; "All" still works
  }, []);

  // UI-level guard — backend requireRole('manager', 'inspector') is the real
  // enforcement.
  if (profile && profile.role !== 'manager' && profile.role !== 'inspector') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 4 }, px: 2 }}>
      <Container maxWidth="lg" disableGutters>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h5" component="h1" fontWeight={700}>
              {isInspector
                ? 'Completed work'
                : tab === REVIEW_TAB
                ? 'Needs Manual Review'
                : 'Triage queue'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {isInspector
                ? 'Lift inspections with rectified defects, awaiting your review'
                : tab === REVIEW_TAB
                ? 'Low-confidence CV detections awaiting a manual call'
                : 'Open work, most urgent first — sorted by AI priority score'}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
            {/* Filters narrow within a tab; the tab chooses which statuses. The
                review queue has no filters yet. */}
            {/* Scorecard drill-through filter — shown as a removable chip so
                the manager can see (and escape) the narrowed view. */}
            {(contractor || overdue) && (
              <Chip
                size="small"
                color="warning"
                label={`${contractor || 'All contractors'}${overdue ? ' — overdue only' : ''}`}
                onDelete={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete('contractor');
                  next.delete('overdue');
                  setSearchParams(next, { replace: true });
                }}
              />
            )}
            {tab !== REVIEW_TAB && (
              <>
                <TextField
                  select size="small" label="Category" value={category}
                  onChange={setFilter('category')} sx={{ minWidth: 150 }}
                >
                  <MenuItem value="">All</MenuItem>
                  {CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select size="small" label="Block" value={block}
                  onChange={setFilter('block')} sx={{ minWidth: 110 }}
                >
                  <MenuItem value="">All</MenuItem>
                  {blockOptions.map((b) => (
                    <MenuItem key={b} value={b}>{b}</MenuItem>
                  ))}
                </TextField>
              </>
            )}
            {/* Closed records live on their own page — out of the way unless
                the manager asks for them. */}
            {!isInspector && (
              <Button
                component={RouterLink}
                to="/inspections/history"
                size="small"
                color="inherit"
                startIcon={<HistoryOutlinedIcon />}
              >
                History
              </Button>
            )}
          </Stack>
        </Stack>

        {!isInspector && (
          <Tabs
            value={tab}
            onChange={(e, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 3 }}
          >
            {QUEUE_TABS.map((t) => (
              <Tab key={t.key} value={t.key} label={t.label} />
            ))}
            <Tab value={REVIEW_TAB} label="Needs Manual Review" />
          </Tabs>
        )}

        {/* Background-refresh indicator. The 4px box is always in the layout so
            the table never jumps when a socket-driven refetch starts. */}
        {tab !== REVIEW_TAB && (
          <Box sx={{ height: 4, mb: 0.5 }}>
            {refreshing && <LinearProgress sx={{ height: 2, borderRadius: 1 }} />}
          </Box>
        )}

        {tab !== REVIEW_TAB ? (
          loading ? (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress />
            </Stack>
          ) : loadError ? (
            <Alert severity="error">Could not load the queue. Refresh to try again.</Alert>
          ) : rows.length === 0 ? (
            <Paper elevation={1} sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                No inspections match the current filters.
              </Typography>
            </Paper>
          ) : (
            <TableContainer component={Paper} elevation={1} sx={{ borderRadius: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Block</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell align="right">Score</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => {
                    const p = priorityDisplay(r.priority);
                    return (
                    <TableRow
                      key={r.id}
                      hover
                      onClick={() => navigate(`/inspections/${r.id}`)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {r.title}
                        </Typography>
                      </TableCell>
                      <TableCell>{r.location_block}</TableCell>
                      <TableCell>{r.category}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={p.label}
                          sx={{ bgcolor: p.bg, color: p.fg, fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell align="right">{r.ai_priority_score ?? '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={r.status} />
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )
        ) : (
          <ManualReviewQueue />
        )}
      </Container>
    </Box>
  );
}
