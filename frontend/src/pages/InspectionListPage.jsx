// UC-002 manager triage queue. All inspections from GET /api/inspections,
// most urgent first (AI priority score), with status/category/block filters
// held in the URL so the dashboard heatmap can drill through to a pre-filtered
// queue. Row click opens the detail/triage view.
// Inspectors also read this endpoint (backend allows it read-only) to review
// completed work before the manager's joint close — always filtered to
// status=Rectified and without the manual-review tab.
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
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
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { getFilterOptions } from '../services/analyticsService';
import { priorityDisplay } from '../utils/priorityDisplay';
import { CATEGORIES } from '../utils/inspectionOptions';
import ManualReviewQueue from '../components/cv/ManualReviewQueue';

// Filterable statuses (migration 004 CHECK, minus 'Closed' — closed records are
// archived with is_deleted = TRUE, so that filter could never return rows).
const STATUSES = [
  'Open', 'Pending Assignment', 'Assigned', 'Acknowledged',
  'On Hold', 'Rectified', 'Resolved',
];

export default function InspectionListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isInspector = profile?.role === 'inspector';

  const [tab, setTab] = useState(0); // 0 = Triage queue, 1 = Needs Manual Review (UC-007)
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Filters live in the URL, so the dashboard heatmap can drill through to a
  // pre-filtered queue (/inspections?block=44A&category=Lift) and so a filtered
  // view stays bookmarkable — same pattern as DashboardPage / AdminCostPage.
  const [searchParams, setSearchParams] = useSearchParams();
  // Inspectors only ever see completed work awaiting their review.
  const status = isInspector ? 'Rectified' : searchParams.get('status') ?? '';
  const category = searchParams.get('category') ?? '';
  const block = searchParams.get('block') ?? '';

  // Replace (not push) so back doesn't step through every dropdown change;
  // empty values are dropped to keep the URL clean.
  const setFilter = (key) => (e) => {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) {
      next.set(key, e.target.value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = {};
    if (status) params.status = status;
    if (category) params.category = category;
    if (block) params.block = block;
    api
      .get('/api/inspections', { params })
      .then((res) => {
        if (active) {
          setRows(res.data.data);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, category, block]);

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
              {isInspector ? 'Completed work' : tab === 0 ? 'Triage queue' : 'Needs Manual Review'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {isInspector
                ? 'Lift inspections with rectified defects, awaiting your review'
                : tab === 0
                ? 'Most urgent first — sorted by AI priority score'
                : 'Low-confidence CV detections awaiting a manual call'}
            </Typography>
          </Box>

          {/* Filters — triage queue only; the review queue has no filters yet. */}
          {tab === 0 && (
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              {!isInspector && (
                <TextField
                  select size="small" label="Status" value={status}
                  onChange={setFilter('status')} sx={{ minWidth: 150 }}
                >
                  <MenuItem value="">All</MenuItem>
                  {STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>{s}</MenuItem>
                  ))}
                </TextField>
              )}
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
            </Stack>
          )}
        </Stack>

        {!isInspector && (
          <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 3 }}>
            <Tab label="Triage queue" />
            <Tab label="Needs Manual Review" />
          </Tabs>
        )}

        {tab === 0 ? (
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
