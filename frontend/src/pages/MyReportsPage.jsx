// UC-003 "My reports" — the originator's status tracker. Lists the signed-in
// resident's or inspector's live records from GET /api/inspections/my, their
// closed ones from GET /api/my-reports/history, expands either for the full
// detail and audit history, keeps both live over Socket.IO (the insp-{id} room),
// and takes a satisfaction rating on the outcome.
// REST listing (task 3.11); Socket.IO wiring lives in SocketContext/SocketService.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  Grid2 as Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Rating,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import ReportCard from '../components/inspections/ReportCard';
import StatTile from '../components/common/StatTile';
import EmptyState from '../components/common/EmptyState';
import { useSocket } from '../context/SocketContext';
import { STATUS_DISPLAY, statusDisplay, statusGroup } from '../utils/statusDisplay';
import {
  applyRating,
  applyStatusUpdate,
  countAwaitingRating,
  isRatable,
} from '../utils/myReports';

const EMPTY_DRAFT = { value: null, comment: '' };

// Ratable once the work is done; rating submission is a later task.
// Closed records do reach this page — /api/inspections/my returns the caller's
// full history including archived ones, so their own record of a report never
// disappears.
const RATABLE_STATUSES = ['Resolved', 'Closed'];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Search matches the title or the record id (a resident pasting part of a
// link/id still finds it); status filter is an exact match, 'all' = no filter.
function matchesFilter(r, query, status) {
  if (status !== 'all' && r.status !== status) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return r.title?.toLowerCase().includes(q) || r.id?.toLowerCase().includes(q);
}

export default function MyReportsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isInspector = profile?.role === 'inspector';
  const [reports, setReports] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  const [drafts, setDrafts] = useState({});
  const [ratingBusyId, setRatingBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const { socket, connected, joinRoom, leaveRoom } = useSocket();

  // UC-003 names this "My reports" for residents and "My inspections" for
  // inspectors — same page, scoped to whoever is signed in. `isInspector` is
  // derived from `profile` at the top of the component.
  const pageTitle = isInspector ? 'My inspections' : 'My reports';
  const newReportRoute = isInspector ? '/inspections/new' : '/report';
  const newReportLabel = isInspector ? 'New inspection' : 'Report a new issue';

  // The status_update handler is registered once per socket, so it reads the
  // open record from a ref rather than closing over a stale expandedId.
  const expandedRef = useRef(null);
  useEffect(() => {
    expandedRef.current = expandedId;
  }, [expandedId]);

  // Same reason: the handler needs the current list (to tell my reports from the
  // neighbours' updates the block room also carries) without re-subscribing on
  // every list change.
  const reportsRef = useRef([]);
  useEffect(() => {
    reportsRef.current = reports;
  }, [reports]);

  // Both lists, in one pass. The live list is the originator view of the shared
  // inspections endpoint; the history list is the closed records it excludes.
  const loadLists = useCallback(async ({ initial = false } = {}) => {
    try {
      const [live, past] = await Promise.all([
        api.get('/api/inspections/my'),
        api.get('/api/my-reports/history'),
      ]);
      setReports(live.data.data);
      setHistory(past.data.data);
      setLoadError(false);
    } catch {
      if (initial) {
        setLoadError(true);
      } else {
        // A background re-sync failed. Keep the last good data on screen, but
        // say so — silently showing stale cards is what the live banner is
        // meant to prevent.
        setToast({ severity: 'warning', text: 'Could not refresh — showing the last update.' });
      }
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLists({ initial: true });
  }, [loadLists]);

  // Fetch (or re-fetch) the open record.
  const loadDetail = useCallback(async (id, { silent = false } = {}) => {
    if (!silent) {
      setDetailLoading(true);
      setDetailError(false);
    }
    try {
      const res = await api.get(`/api/my-reports/${id}`);
      if (expandedRef.current !== id) return;
      setDetail(res.data);
    } catch {
      if (expandedRef.current !== id) return;
      setDetailError(true);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  function toggleDetail(id) {
    if (expandedId) leaveRoom(`insp-${expandedId}`);
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    joinRoom(`insp-${id}`);
    loadDetail(id);
  }

  // Live status pushed by the manager (UC-002) or contractor (UC-010): patch the
  // card in place, and refresh the open record so its audit log keeps up too —
  // the event carries a status, not a history row. A close (UC-004) archives the
  // record, so it moves out of the live list and into the history section.
  useEffect(() => {
    if (!socket) return undefined;
    const onStatusUpdate = (payload) => {
      const { reports: next, outcome } = applyStatusUpdate(reportsRef.current, payload);
      if (outcome === 'ignored') return;

      setReports(next);
      if (outcome === 'closed') {
        setToast({
          severity: 'info',
          text: 'This report has been officially closed — find it under Past reports.',
        });
        loadLists();
      }
      if (payload.id === expandedRef.current) loadDetail(payload.id, { silent: true });
    };
    socket.on('status_update', onStatusUpdate);
    return () => socket.off('status_update', onStatusUpdate);
  }, [socket, loadDetail, loadLists]);

  // Coming back from a dropped connection: room membership doesn't survive it,
  // and any update pushed while offline was missed — rejoin and re-sync rather
  // than showing stale cards that look live. Starts true so the socket's first
  // connect, which happens moments after mount, isn't mistaken for a reconnect
  // and doesn't re-fetch what the page just loaded.
  const wasConnected = useRef(true);
  useEffect(() => {
    if (connected) {
      if (expandedId) joinRoom(`insp-${expandedId}`);
      if (wasConnected.current === false) loadLists();
    }
    wasConnected.current = connected;
  }, [connected, expandedId, joinRoom, loadLists]);

  // Leave the room on unmount (navigating away with a record open).
  useEffect(
    () => () => {
      if (expandedRef.current) leaveRoom(`insp-${expandedRef.current}`);
    },
    [leaveRoom]
  );

  async function submitRating(id) {
    const draft = drafts[id];
    if (!draft?.value) return;
    setRatingBusyId(id);
    // The record may sit in either list, so patch both.
    const store = (rating, comment) => {
      setReports((prev) => applyRating(prev, id, rating, comment));
      setHistory((prev) => applyRating(prev, id, rating, comment));
    };
    try {
      const res = await api.post(`/api/my-reports/${id}/rating`, {
        rating: draft.value,
        comment: draft.comment || null,
      });
      store(res.data.satisfaction_rating, res.data.satisfaction_comment);
      setToast({ severity: 'success', text: 'Thank you for your feedback.' });
    } catch (err) {
      if (err.response?.status === 409) {
        // Already rated elsewhere — show it as submitted rather than an error.
        store(draft.value, draft.comment || null);
      } else {
        setToast({ severity: 'error', text: 'Your rating could not be saved — please try again.' });
      }
    } finally {
      setRatingBusyId(null);
    }
  }

  // Shared props for a card in either list.
  const cardProps = (r) => ({
    report: r,
    ratable: isRatable(r),
    expanded: expandedId === r.id,
    detail,
    detailLoading,
    detailError,
    draft: drafts[r.id] ?? EMPTY_DRAFT,
    ratingBusy: ratingBusyId === r.id,
    onToggle: () => toggleDetail(r.id),
    onRetryDetail: () => loadDetail(r.id),
    onDraftChange: (draft) => setDrafts((prev) => ({ ...prev, [r.id]: draft })),
    onSubmitRating: () => submitRating(r.id),
  });

  const unratedCount = countAwaitingRating(history);

  // KPI counts — computed from what's already fetched, no new endpoint.
  const counts = useMemo(() => {
    const all = [...reports, ...history];
    const c = { review: 0, progress: 0, done: 0 };
    for (const r of all) c[statusGroup(r.status)] += 1;
    return { total: all.length, ...c };
  }, [reports, history]);

  const filteredReports = useMemo(
    () => reports.filter((r) => matchesFilter(r, search, statusFilter)),
    [reports, search, statusFilter]
  );
  const filteredHistory = useMemo(
    () => history.filter((r) => matchesFilter(r, search, statusFilter)),
    [history, search, statusFilter]
  );
  const isFiltering = Boolean(search) || statusFilter !== 'all';

  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>
            {pageTitle}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Track and manage the {isInspector ? 'inspections' : 'reports'} you have submitted.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          component={RouterLink}
          to={newReportRoute}
        >
          {newReportLabel}
        </Button>
      </Stack>

      {socket && !connected && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Live updates paused — reconnecting…
        </Alert>
      )}

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="All reports"
            value={counts.total}
            sub="Total reports submitted"
            icon={DescriptionOutlinedIcon}
            iconColor="primary"
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Under review"
            value={counts.review}
            sub="Reports being reviewed"
            icon={AccessTimeOutlinedIcon}
            iconColor="warning"
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="In progress"
            value={counts.progress}
            sub="Work in progress"
            icon={FactCheckOutlinedIcon}
            iconColor="info"
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Resolved"
            value={counts.done}
            sub="Issues resolved"
            icon={CheckCircleOutlineIcon}
            iconColor="success"
          />
        </Grid>
      </Grid>

      {/* Search + status filter */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search by issue title or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }}
        />
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            displayEmpty
            startAdornment={
              <InputAdornment position="start">
                <FilterAltOutlinedIcon fontSize="small" />
              </InputAdornment>
            }
          >
            <MenuItem value="all">All statuses</MenuItem>
            {Object.entries(STATUS_DISPLAY).map(([status, { label }]) => (
              <MenuItem key={status} value={status}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {loading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : loadError ? (
        <Alert severity="error">
          Could not load your {isInspector ? 'inspections' : 'reports'}. Refresh to try again.
        </Alert>
      ) : reports.length === 0 && history.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <EmptyState
            icon={DescriptionOutlinedIcon}
            title={isInspector ? 'No inspections yet' : 'No reports yet'}
            description={
              isInspector
                ? "You haven't filed any inspections."
                : "You haven't submitted any reports."
            }
            actionLabel={newReportLabel}
            actionTo={newReportRoute}
          />
        </Paper>
      ) : (
        <>
          {filteredReports.length === 0 ? (
            <Paper variant="outlined" sx={{ borderRadius: 2 }}>
              <EmptyState
                dense
                icon={DescriptionOutlinedIcon}
                description={
                  isFiltering
                    ? 'No reports match your search or filter.'
                    : `Nothing open right now.`
                }
                actionLabel={isFiltering ? undefined : newReportLabel}
                actionTo={isFiltering ? undefined : newReportRoute}
              />
            </Paper>
          ) : (
            <Stack spacing={2}>
              {filteredReports.map((r) => {
                const display = statusDisplay(r.status);
                const ratable = !isInspector && RATABLE_STATUSES.includes(r.status);
                return (
                  <Paper
                    key={r.id}
                    variant="outlined"
                    onClick={isInspector ? () => navigate(`/inspections/${r.id}`) : undefined}
                    sx={{
                      p: { xs: 2.5, sm: 3 },
                      borderRadius: 2,
                      ...(isInspector && {
                        cursor: 'pointer',
                        transition: (theme) => theme.transitions.create('box-shadow'),
                        '&:hover': { boxShadow: 3 },
                      }),
                    }}
                  >
                    <Stack direction="row" spacing={2}>
                      {r.photo_url && (
                        <Box
                          component="img"
                          src={r.photo_url}
                          alt=""
                          sx={{
                            width: 72,
                            height: 72,
                            objectFit: 'cover',
                            borderRadius: 2,
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="flex-start"
                          spacing={1}
                        >
                          <Typography variant="subtitle1" fontWeight={700} sx={{ minWidth: 0 }}>
                            {r.title}
                          </Typography>
                          <Chip size="small" color={display.color} label={display.label} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {r.category} · Block {r.location_block}
                          {r.location_unit ? ` #${r.location_unit}` : ''} ·{' '}
                          {formatDate(r.created_at)}
                        </Typography>

                        {ratable && (
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                            <Rating
                              size="small"
                              value={r.satisfaction_rating ?? null}
                              readOnly={Boolean(r.satisfaction_rating)}
                              disabled={!r.satisfaction_rating}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {r.satisfaction_rating ? 'Your rating' : 'Not yet rated'}
                            </Typography>
                          </Stack>
                        )}
                      </Box>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </>
      )}

      {history.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Button
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            aria-controls="past-reports"
            sx={{ px: 0 }}
          >
            {historyOpen ? 'Hide' : 'Show'} past reports ({filteredHistory.length}
            {isFiltering ? ` of ${history.length}` : ''})
            {unratedCount > 0 ? ` · ${unratedCount} awaiting your rating` : ''}
          </Button>
          <Collapse in={historyOpen} unmountOnExit>
            <Stack spacing={2} id="past-reports" sx={{ mt: 1 }}>
              {filteredHistory.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No past reports match your search or filter.
                </Typography>
              ) : (
                filteredHistory.map((r) => <ReportCard key={r.id} {...cardProps(r)} />)
              )}
            </Stack>
          </Collapse>
        </Box>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
