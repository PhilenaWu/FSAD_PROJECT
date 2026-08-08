// UC-010 contractor portal — the 4C-1 differentiator. A contractor sees the
// defects assigned to them (soonest deadline first, with a days-remaining
// countdown), opens one, acknowledges it, then completes the work: per-item
// completion photo + remark, and a canvas e-signature to finalize ("Submit work
// done"). They can also Save progress on some items and finish the rest later
// (Alt Flow B), or put a defect on hold with a reason (Alt Flow A).
//
// The inbox auto-refreshes (15s poll + tab focus) and pops a toast when a new
// defect is assigned, since the manager's assign event isn't pushed to the
// contractor's socket room.
//
// Master-detail on one page: the inbox list on the left, the selected defect's
// work panel on the right. Backend requireRole('contractor') is the real gate;
// the UI-level redirect just avoids showing an empty portal to other roles.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid2 as Grid,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AssignmentLateOutlinedIcon from '@mui/icons-material/AssignmentLateOutlined';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import FilterListOutlinedIcon from '@mui/icons-material/FilterListOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import SwapVertOutlinedIcon from '@mui/icons-material/SwapVertOutlined';
import EmptyState from '../components/common/EmptyState';
import StatTile from '../components/common/StatTile';
import SignaturePad from '../components/SignaturePad';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { compressImage } from '../utils/imageCompress';
import { statusDisplay } from '../utils/statusDisplay';
import { getAssigned, acknowledge, rectify, hold, resume } from '../services/contractorService';

// Statuses excluded from the Overdue/Due-soon counts: On Hold pauses the
// deadline (matching the manager scorecard's G11-consistent definition), and
// a finished record has nothing left "due". Not the same set as the
// "Completed" stat tile below, which excludes On Hold — a paused defect is
// still in-progress work, not done.
const DEADLINE_INACTIVE_STATUSES = ['On Hold', 'Rectified', 'Resolved', 'Closed'];
const DUE_SOON_DAYS = 3; // matches DeadlineChip's own amber threshold below

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Deadline chip: green when comfortable, amber ≤3 days, red when overdue.
// Hidden while a defect is On Hold (the countdown pauses).
function DeadlineChip({ days }) {
  if (days === null || days === undefined) {
    return <Chip size="small" variant="outlined" label="No deadline" />;
  }
  if (days < 0) {
    return <Chip size="small" color="error" label={`Overdue by ${-days}d`} />;
  }
  const color = days <= 3 ? 'warning' : 'success';
  return <Chip size="small" color={color} label={`${days}d left`} />;
}

export default function ContractorInboxPage() {
  const { profile } = useAuth();
  const { socket } = useSocket();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [blockFilter, setBlockFilter] = useState('all'); // Z.14 — inbox block filter

  // Per-defect-item completion input:
  // { [checklist_result_id]: { remark, file, preview, done } }.
  const [completion, setCompletion] = useState({});
  // Overall remark — the audit note; the only work field when a record has no
  // checklist items (e.g. a resident complaint assigned to a contractor).
  const [overallRemark, setOverallRemark] = useState('');
  const signPadRef = useRef(null);

  const [busy, setBusy] = useState(false); // an action (ack/rectify/hold) in flight
  const [feedback, setFeedback] = useState(null); // { severity, message }

  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false); // finalize confirmation

  // Live-refresh affordances.
  const [lastUpdated, setLastUpdated] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '' });
  const [highlightId, setHighlightId] = useState(null); // newly-arrived card

  // Top-of-page filtering/sorting. `bucket` covers both the visible Tabs
  // ('all' | 'overdue' | 'dueSoon') and the invisible-in-tabs values the stat
  // tiles jump to ('newlyAssigned' | 'inProgress' | 'completed') — the Tabs
  // component just shows none selected when one of those is active.
  const [bucket, setBucket] = useState('all');
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'deadline' | 'oldest'
  const [blockFilter, setBlockFilter] = useState(''); // '' = every block
  const [sortAnchor, setSortAnchor] = useState(null);
  const [filterAnchor, setFilterAnchor] = useState(null);

  const selected = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
  );

  // Stat-tile counts, computed from the full (unfiltered) inbox.
  const counts = useMemo(() => {
    let newlyAssigned = 0;
    let inProgress = 0;
    let completed = 0;
    for (const it of items) {
      if (it.status === 'Assigned') newlyAssigned += 1;
      else if (it.status === 'Acknowledged' || it.status === 'On Hold') inProgress += 1;
      else completed += 1;
    }
    return { newlyAssigned, inProgress, completed, total: items.length };
  }, [items]);

  const overdueCount = useMemo(
    () =>
      items.filter(
        (it) =>
          it.days_remaining != null &&
          it.days_remaining < 0 &&
          !DEADLINE_INACTIVE_STATUSES.includes(it.status)
      ).length,
    [items]
  );
  const dueSoonCount = useMemo(
    () =>
      items.filter(
        (it) =>
          it.days_remaining != null &&
          it.days_remaining >= 0 &&
          it.days_remaining <= DUE_SOON_DAYS &&
          !DEADLINE_INACTIVE_STATUSES.includes(it.status)
      ).length,
    [items]
  );

  // Distinct blocks present in the inbox, for the Filter menu.
  const blocks = useMemo(
    () => [...new Set(items.map((it) => it.location_block).filter(Boolean))].sort(),
    [items]
  );

  // The inbox list, filtered by the active bucket/block and sorted.
  const visibleItems = useMemo(() => {
    let list = items;
    if (bucket === 'overdue') {
      list = list.filter(
        (it) =>
          it.days_remaining != null &&
          it.days_remaining < 0 &&
          !DEADLINE_INACTIVE_STATUSES.includes(it.status)
      );
    } else if (bucket === 'dueSoon') {
      list = list.filter(
        (it) =>
          it.days_remaining != null &&
          it.days_remaining >= 0 &&
          it.days_remaining <= DUE_SOON_DAYS &&
          !DEADLINE_INACTIVE_STATUSES.includes(it.status)
      );
    } else if (bucket === 'newlyAssigned') {
      list = list.filter((it) => it.status === 'Assigned');
    } else if (bucket === 'inProgress') {
      list = list.filter((it) => it.status === 'Acknowledged' || it.status === 'On Hold');
    } else if (bucket === 'completed') {
      list = list.filter((it) => it.status !== 'Assigned' && it.status !== 'Acknowledged' && it.status !== 'On Hold');
    }
    if (blockFilter) list = list.filter((it) => it.location_block === blockFilter);

    const sorted = [...list];
    if (sortBy === 'newest') {
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (sortBy === 'deadline') {
      sorted.sort((a, b) => {
        if (a.days_remaining == null) return 1;
        if (b.days_remaining == null) return -1;
        return a.days_remaining - b.days_remaining;
      });
    }
    return sorted;
  }, [items, bucket, blockFilter, sortBy]);

  const SORT_LABELS = { newest: 'Newest first', deadline: 'Deadline soonest', oldest: 'Oldest first' };

  // Latest completion mirrored to a ref so cleanup (defect switch / unmount) can
  // revoke the object URLs of attached-photo previews without re-subscribing.
  const completionRef = useRef(completion);
  useEffect(() => {
    completionRef.current = completion;
  });
  const revokeAllPreviews = () => {
    Object.values(completionRef.current).forEach(
      (c) => c?.preview && URL.revokeObjectURL(c.preview)
    );
  };

  // Ids from the previous fetch, to detect a newly-assigned defect (null until
  // the first load, so we don't toast for the initial inbox contents).
  const prevIdsRef = useRef(null);

  // `background` refreshes (polling / tab focus) skip the full-page spinner and
  // error screen so the list doesn't flash while the contractor is working.
  const load = useCallback((background = false) => {
    if (!background) setLoading(true);
    getAssigned()
      .then((data) => {
        setItems(data);
        setLoadError(false);
        setLastUpdated(new Date());
        // Keep the current selection if it still exists, else pick the first.
        setSelectedId((prev) =>
          data.some((d) => d.id === prev) ? prev : (data[0]?.id ?? null)
        );
        // Toast + highlight when a defect appears that wasn't here before.
        if (prevIdsRef.current) {
          const prevSet = new Set(prevIdsRef.current);
          const added = data.find((d) => !prevSet.has(d.id));
          if (added) {
            setToast({ open: true, message: `New defect assigned — Block ${added.location_block}` });
            setHighlightId(added.id);
            setTimeout(() => setHighlightId((h) => (h === added.id ? null : h)), 4000);
          }
        }
        prevIdsRef.current = data.map((d) => d.id);
      })
      .catch(() => {
        if (!background) setLoadError(true);
      })
      .finally(() => {
        if (!background) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh: poll the inbox and refetch when the tab regains focus so
  // assignments show up without a manual reload. Skipped while an action is in
  // flight or the tab is hidden. Background refresh → no spinner flash.
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    const refresh = () => {
      if (!busyRef.current && document.visibilityState === 'visible') load(true);
    };
    const interval = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  // Push refresh (Z.3). The poll above already gets there within 15 s, but a
  // notification addressed to this contractor's room means something just
  // changed on one of their records, so refetch immediately rather than waiting
  // out the interval. Skipped mid-action so an in-flight submit isn't disturbed.
  //
  // This listens for `notification` rather than `status_update` on purpose: the
  // contractor room receives no status_update today (the assign and reject emits
  // omit contractor-{user_id} — D.5), whereas notifyEvent's `users` scope emits
  // straight to it. Assign and reject start refreshing here on their own once
  // those triggers are wired, with no further change to this page.
  useEffect(() => {
    if (!socket) return;
    const onNotification = () => {
      if (!busyRef.current) load(true);
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [socket, load]);

  // Reset the work panel whenever the selected defect changes; revoke the
  // previous defect's photo previews first so object URLs don't leak.
  useEffect(() => {
    revokeAllPreviews();
    setCompletion({});
    setOverallRemark('');
    setFeedback(null);
    signPadRef.current?.clear();
  }, [selectedId]);

  // Revoke any outstanding previews when the page unmounts.
  useEffect(() => () => revokeAllPreviews(), []);

  // Attach / replace a completion photo for one item, managing the preview URL.
  function setItemPhoto(id, file) {
    setCompletion((c) => {
      const prev = c[id];
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return { ...c, [id]: { ...prev, file, preview: file ? URL.createObjectURL(file) : undefined } };
    });
  }

  async function handleAcknowledge() {
    setBusy(true);
    setFeedback(null);
    try {
      await acknowledge(selected.id);
      setFeedback({ severity: 'success', message: 'Defect acknowledged.' });
      load(true);
    } catch (err) {
      setFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Could not acknowledge — please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  // Submit rectification work. finalize=false saves progress (no signature);
  // finalize=true completes the record and requires the e-signature.
  async function handleRectify(finalize) {
    setBusy(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      const defects = selected.checklist_results ?? [];
      const itemsPayload = defects.map((d) => ({
        checklist_result_id: d.id,
        completion_remark: completion[d.id]?.remark ?? '',
        rectified: completion[d.id]?.done ?? d.rectified,
      }));
      formData.append('items', JSON.stringify(itemsPayload));

      // Per-item completion photos, compressed to ≤100 KB before upload.
      for (const d of defects) {
        const file = completion[d.id]?.file;
        if (file) {
          const compressed = await compressImage(file);
          formData.append(`photo_${d.id}`, compressed, compressed.name);
        }
      }

      if (overallRemark.trim()) formData.append('remark', overallRemark.trim());
      formData.append('finalize', finalize ? 'true' : 'false');

      if (finalize) {
        const sigBlob = await signPadRef.current.toBlob();
        formData.append('signature', sigBlob, 'signature.png');
      }

      await rectify(selected.id, formData);
      // Finalising moves the defect to 'Rectified', and the status banner lower
      // down already announces that it is awaiting the manager's endorsement —
      // a success message here too put two identical green alerts on screen at
      // once. Saving progress changes no status, so that path still needs one.
      setFeedback(
        finalize
          ? null
          : {
              severity: 'success',
              message: 'Progress saved — finish the remaining items when ready.',
            }
      );
      load(true);
    } catch (err) {
      setFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Submit failed — please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  // "Submit work done" → validate the signature, then confirm before finalizing.
  function openFinalize() {
    setFeedback(null);
    if (signPadRef.current?.isEmpty()) {
      setFeedback({ severity: 'error', message: 'Please sign before submitting.' });
      return;
    }
    setConfirmOpen(true);
  }

  async function handleHold() {
    setBusy(true);
    setFeedback(null);
    try {
      await hold(selected.id, holdReason.trim());
      setHoldOpen(false);
      setHoldReason('');
      setFeedback({ severity: 'success', message: 'Defect placed on hold — deadline paused.' });
      load(true);
    } catch (err) {
      setFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Could not place on hold — please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  // Clear the hold and restart the clock (Alt Flow A, G11). The server restores
  // whichever status the record held before the pause, so no status is assumed
  // here — the refetch shows what it actually became.
  async function handleResume() {
    setBusy(true);
    setFeedback(null);
    try {
      await resume(selected.id);
      setFeedback({
        severity: 'success',
        message: 'Work resumed — the deadline was extended by the time held.',
      });
      load(true);
    } catch (err) {
      setFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Could not resume — please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  // UI-level guard — backend requireRole('contractor') is the real enforcement.
  if (profile && profile.role !== 'contractor') {
    return <Navigate to="/dashboard" replace />;
  }

  const canRectify =
    selected && ['Assigned', 'Acknowledged', 'On Hold'].includes(selected.status);
  const defects = selected?.checklist_results ?? [];
  const doneCount = defects.filter((d) => completion[d.id]?.done ?? d.rectified).length;
  const allDone = defects.length === 0 || doneCount === defects.length;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 4 }, px: 2 }}>
      <Container maxWidth="lg" disableGutters>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <AssignmentTurnedInOutlinedIcon color="primary" />
          <Typography variant="h5" fontWeight={700}>
            Assigned defects
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }} flexWrap="wrap">
          <Typography variant="body2" color="text.secondary">
            Acknowledge a defect, complete the work, then upload proof and e-sign.
          </Typography>
          {lastUpdated && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
              <Typography variant="caption" color="text.secondary">
                Live · updated {lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </Typography>
            </Stack>
          )}
        </Stack>

        {!loading && !loadError && (
          <>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatTile
                  label="Newly assigned"
                  value={counts.newlyAssigned}
                  sub="Awaiting your action"
                  icon={AssignmentLateOutlinedIcon}
                  iconColor="primary"
                  onClick={() => setBucket('newlyAssigned')}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatTile
                  label="In progress"
                  value={counts.inProgress}
                  sub="Work in progress"
                  icon={AccessTimeOutlinedIcon}
                  iconColor="warning"
                  onClick={() => setBucket('inProgress')}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatTile
                  label="Completed"
                  value={counts.completed}
                  sub="Work completed"
                  icon={CheckCircleOutlineIcon}
                  iconColor="success"
                  onClick={() => setBucket('completed')}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <StatTile
                  label="Total defects"
                  value={counts.total}
                  sub="All time"
                  icon={DescriptionOutlinedIcon}
                  iconColor="secondary"
                  onClick={() => setBucket('all')}
                />
              </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                alignItems={{ xs: 'stretch', md: 'center' }}
                justifyContent="space-between"
                spacing={1.5}
                sx={{ px: 2, py: 1 }}
              >
                <Tabs
                  value={['all', 'overdue', 'dueSoon'].includes(bucket) ? bucket : false}
                  onChange={(_, v) => setBucket(v)}
                  textColor="primary"
                  indicatorColor="primary"
                  variant="scrollable"
                  scrollButtons="auto"
                >
                  <Tab label={`All (${counts.total})`} value="all" />
                  <Tab label={`Overdue (${overdueCount})`} value="overdue" />
                  <Tab label={`Due soon (${dueSoonCount})`} value="dueSoon" />
                </Tabs>

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FilterListOutlinedIcon />}
                    onClick={(e) => setFilterAnchor(e.currentTarget)}
                  >
                    {blockFilter ? `Block ${blockFilter}` : 'Filter'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SwapVertOutlinedIcon />}
                    onClick={(e) => setSortAnchor(e.currentTarget)}
                  >
                    Sort by: {SORT_LABELS[sortBy]}
                  </Button>
                </Stack>

                <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)}>
                  <MenuItem
                    selected={!blockFilter}
                    onClick={() => { setBlockFilter(''); setFilterAnchor(null); }}
                  >
                    All blocks
                  </MenuItem>
                  {blocks.map((b) => (
                    <MenuItem
                      key={b}
                      selected={blockFilter === b}
                      onClick={() => { setBlockFilter(b); setFilterAnchor(null); }}
                    >
                      Block {b}
                    </MenuItem>
                  ))}
                </Menu>

                <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}>
                  {Object.entries(SORT_LABELS).map(([key, label]) => (
                    <MenuItem
                      key={key}
                      selected={sortBy === key}
                      onClick={() => { setSortBy(key); setSortAnchor(null); }}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </Menu>
              </Stack>
            </Paper>
          </>
        )}

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : loadError ? (
          <Alert severity="error">Could not load your assigned defects.</Alert>
        ) : items.length === 0 ? (
          <Paper elevation={1} sx={{ borderRadius: 3 }}>
            <EmptyState
              icon={InboxOutlinedIcon}
              title="Nothing assigned yet"
              description="Defects the manager assigns to you will appear here."
              actionLabel="Check for new assignments"
              onAction={() => load()}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', pb: 3 }}>
              Pull down to refresh or check back later.
            </Typography>
          </Paper>
        ) : visibleItems.length === 0 ? (
          <Paper elevation={1} sx={{ borderRadius: 3 }}>
            <EmptyState
              icon={InboxOutlinedIcon}
              title="No defects match"
              description="Nothing in this view — try a different tab or filter."
              actionLabel="Clear filters"
              onAction={() => { setBucket('all'); setBlockFilter(''); }}
              dense
            />
          </Paper>
        ) : (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
            {/* Inbox list */}
            <Stack spacing={1.5} sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0 }}>
              {visibleItems.map((it) => {
                const active = it.id === selectedId;
                const highlight = it.id === highlightId;
                return (
                  <Paper
                    key={it.id}
                    elevation={active ? 3 : 1}
                    onClick={() => setSelectedId(it.id)}
                    sx={{
                      p: 2, borderRadius: 3, cursor: 'pointer',
                      border: 2,
                      borderColor: active ? 'primary.main' : highlight ? 'success.main' : 'transparent',
                      transition: 'border-color 0.3s',
                      '&:hover': { borderColor: active ? 'primary.main' : 'divider' },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ pr: 1 }}>
                        {it.title}
                      </Typography>
                      {it.status === 'On Hold'
                        ? <Chip size="small" color="warning" label="On hold" />
                        : <DeadlineChip days={it.days_remaining} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Block {it.location_block} · {statusDisplay(it.status).label}
                    </Typography>
                  </Paper>
                );
              })}
            </Stack>

            {/* Work panel for the selected defect */}
            {selected && (
              <Paper elevation={1} sx={{ p: 3, borderRadius: 3, flex: 1, width: '100%' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Typography variant="h6" fontWeight={700} sx={{ pr: 2 }}>
                    {selected.title}
                  </Typography>
                  <Chip size="small" variant="outlined" label={statusDisplay(selected.status).label} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Block {selected.location_block}
                  {selected.location_unit ? ` #${selected.location_unit}` : ''} · deadline{' '}
                  {formatDate(selected.target_deadline)}
                </Typography>

                {selected.description && (
                  <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                    {selected.description}
                  </Typography>
                )}

                {/* Primary defect photo (mainly for records without checklist items). */}
                {selected.photo_url && (
                  <Box
                    component="img"
                    src={selected.photo_url}
                    alt="Reported defect"
                    sx={{ maxWidth: '100%', maxHeight: 260, borderRadius: 2, mb: 2, display: 'block' }}
                  />
                )}

                {feedback && (
                  <Alert severity={feedback.severity} onClose={() => setFeedback(null)} sx={{ mb: 2 }}>
                    {feedback.message}
                  </Alert>
                )}

                {/* On hold: the reason, plus the only way back out. Until resume
                    existed a held record was stuck there permanently. */}
                {selected.status === 'On Hold' && (
                  <Alert
                    severity="warning"
                    sx={{ mb: 2 }}
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        startIcon={<PlayArrowOutlinedIcon />}
                        disabled={busy}
                        onClick={handleResume}
                      >
                        Resume
                      </Button>
                    }
                  >
                    {selected.hold_reason ? `On hold — ${selected.hold_reason}` : 'On hold'}
                    <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                      The deadline is paused. Resuming extends it by however long the
                      hold lasted.
                    </Typography>
                  </Alert>
                )}

                {/* Step 1: acknowledge (only while still Assigned). */}
                {selected.status === 'Assigned' && (
                  <Button
                    variant="contained"
                    startIcon={<CheckCircleOutlineIcon />}
                    onClick={handleAcknowledge}
                    disabled={busy}
                    sx={{ mb: 3 }}
                  >
                    Acknowledge
                  </Button>
                )}

                {/* Step 2: rectification work + e-signature. */}
                {canRectify && (
                  <Box component="form" onSubmit={(e) => { e.preventDefault(); openFinalize(); }}>
                    <Divider sx={{ mb: 2 }} />
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        Complete the work
                      </Typography>
                      {defects.length > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {doneCount} of {defects.length} items done
                        </Typography>
                      )}
                    </Stack>

                    {defects.length ? (
                      <Stack spacing={2} sx={{ mb: 2 }}>
                        {defects.map((d) => {
                          const done = completion[d.id]?.done ?? d.rectified;
                          const preview = completion[d.id]?.preview;
                          return (
                            <Paper key={d.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                <Typography variant="subtitle2" fontWeight={700}>
                                  {d.item_text}
                                </Typography>
                                {d.severity && (
                                  <Chip size="small" variant="outlined" label={d.severity} />
                                )}
                              </Stack>
                              {d.remark && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                  Inspector note: {d.remark}
                                </Typography>
                              )}

                              {/* Inspector's original defect photo (spec step 2). */}
                              {d.photo_url && (
                                <Box
                                  component="img"
                                  src={d.photo_url}
                                  alt="Inspector defect photo"
                                  sx={{ maxHeight: 120, borderRadius: 1, mb: 1, display: 'block' }}
                                />
                              )}

                              <TextField
                                label="Completion remark"
                                size="small"
                                fullWidth
                                multiline
                                minRows={2}
                                value={completion[d.id]?.remark ?? ''}
                                onChange={(e) =>
                                  setCompletion((c) => ({
                                    ...c,
                                    [d.id]: { ...c[d.id], remark: e.target.value },
                                  }))
                                }
                                sx={{ mb: 1 }}
                              />

                              {/* Completion photo: attach → thumbnail preview + remove. */}
                              {preview ? (
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                  <Box
                                    component="img"
                                    src={preview}
                                    alt="Completion preview"
                                    sx={{ height: 64, borderRadius: 1, display: 'block' }}
                                  />
                                  <Button size="small" color="error" onClick={() => setItemPhoto(d.id, null)}>
                                    Remove
                                  </Button>
                                </Stack>
                              ) : (
                                <Button variant="outlined" component="label" size="small" sx={{ mb: 1 }}>
                                  Attach completion photo
                                  <input
                                    type="file"
                                    accept="image/*"
                                    hidden
                                    onChange={(e) => setItemPhoto(d.id, e.target.files[0] ?? null)}
                                  />
                                </Button>
                              )}

                              <Box>
                                <FormControlLabel
                                  control={
                                    <Checkbox
                                      checked={done}
                                      onChange={(e) =>
                                        setCompletion((c) => ({
                                          ...c,
                                          [d.id]: { ...c[d.id], done: e.target.checked },
                                        }))
                                      }
                                    />
                                  }
                                  label="Mark this item done"
                                />
                              </Box>
                            </Paper>
                          );
                        })}
                      </Stack>
                    ) : (
                      <TextField
                        label="Work done"
                        size="small"
                        fullWidth
                        multiline
                        minRows={2}
                        value={overallRemark}
                        onChange={(e) => setOverallRemark(e.target.value)}
                        helperText="Describe the rectification work carried out."
                        sx={{ mb: 2 }}
                      />
                    )}

                    <Box sx={{ maxWidth: 400, mb: 2 }}>
                      <SignaturePad ref={signPadRef} label="Your e-signature (required to submit)" />
                    </Box>

                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                      <Button
                        type="submit"
                        variant="contained"
                        disabled={busy || !allDone}
                        startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <CheckCircleOutlineIcon />}
                      >
                        {busy ? 'Working…' : 'Submit work done'}
                      </Button>
                      {defects.length > 0 && (
                        <Button
                          variant="outlined"
                          disabled={busy}
                          startIcon={<SaveOutlinedIcon />}
                          onClick={() => handleRectify(false)}
                        >
                          Save progress
                        </Button>
                      )}
                      <Button
                        variant="outlined"
                        color="warning"
                        disabled={busy}
                        startIcon={<PauseCircleOutlineIcon />}
                        onClick={() => setHoldOpen(true)}
                      >
                        Unable to rectify
                      </Button>
                    </Stack>
                    {!allDone && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Mark all items done to submit, or Save progress to finish later.
                      </Typography>
                    )}
                  </Box>
                )}

                {selected.status === 'Rectified' && (
                  <Alert severity="success">
                    Work submitted — this defect is awaiting the manager's joint endorsement.
                  </Alert>
                )}
              </Paper>
            )}
          </Stack>
        )}

        {!loading && !loadError && (
          <Paper
            variant="outlined"
            sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: 'action.hover' }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <InfoOutlinedIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" fontWeight={700}>
                How it works
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Manager assigns a defect → You acknowledge it → Complete the work → Upload
              proof and e-sign → Manager reviews and closes
            </Typography>
          </Paper>
        )}

        {/* Hold reason dialog (Alt Flow A). */}
        <Dialog open={holdOpen} onClose={() => setHoldOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Unable to rectify</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Tell the manager why (e.g. access denied, part on order, out of scope).
              The deadline countdown pauses until this is resolved.
            </DialogContentText>
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={2}
              label="Reason"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setHoldOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="warning"
              disabled={busy || !holdReason.trim()}
              onClick={handleHold}
            >
              Place on hold
            </Button>
          </DialogActions>
        </Dialog>

        {/* Finalize confirmation. */}
        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Submit work as complete?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              This signs off the rectification and moves the defect to “Rectified” for the
              manager's joint endorsement. You won't be able to edit it afterwards.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => { setConfirmOpen(false); handleRectify(true); }}
            >
              Submit &amp; sign
            </Button>
          </DialogActions>
        </Dialog>

        {/* New-assignment toast. */}
        <Snackbar
          open={toast.open}
          autoHideDuration={5000}
          onClose={() => setToast((t) => ({ ...t, open: false }))}
          message={toast.message}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        />
      </Container>
    </Box>
  );
}
