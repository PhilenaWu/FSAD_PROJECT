// UC-007 (phase task 4.8) — "Needs Manual Review" panel listing low-confidence
// CV detections. Self-fetches (unlike the analytics panels, which share one
// page-level fetch across several components) so it's a true drop-in: render
// <ManualReviewQueue /> anywhere with no data-fetching wiring required from
// the parent page. Intended for IncidentListPage.jsx once UC-002 lands.
//
// Clicking a card opens a review dialog: the manager confirms the detection is
// real by picking a category/priority (creating a ticket), or dismisses it as
// a false positive. Either action removes the card from the queue.
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid2 as Grid,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ImageSearchOutlinedIcon from '@mui/icons-material/ImageSearchOutlined';
import BoundingBoxOverlay from './BoundingBoxOverlay';
import { getManualReviewQueue, createTicketFromDetection, dismissDetection } from '../../services/cvService';
import { CATEGORIES, PRIORITIES } from '../../utils/inspectionOptions';

function formatConfidence(confidence) {
  return `${Math.round(Number(confidence) * 100)}%`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ManualReviewQueue() {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selected, setSelected] = useState(null); // the detection being reviewed
  const [form, setForm] = useState({ category: '', priority: '', location_block: '' });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getManualReviewQueue()
      .then(({ data }) => {
        if (!cancelled) setDetections(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the manual review queue.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openReview(detection) {
    setSelected(detection);
    setDialogError('');
    setForm({
      category: '',
      priority: '',
      location_block: detection.location_block ?? '',
    });
  }

  function closeReview() {
    if (busy) return;
    setSelected(null);
  }

  async function handleCreateTicket(e) {
    e.preventDefault();
    if (!form.category || !form.priority || !form.location_block) {
      setDialogError('Category, priority, and block are all required.');
      return;
    }
    setBusy(true);
    setDialogError('');
    try {
      await createTicketFromDetection(selected.id, form);
      setDetections((prev) => prev.filter((d) => d.id !== selected.id));
      setSelected(null);
    } catch (err) {
      setDialogError(err.response?.data?.message ?? 'Could not create the ticket. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss() {
    setBusy(true);
    setDialogError('');
    try {
      await dismissDetection(selected.id);
      setDetections((prev) => prev.filter((d) => d.id !== selected.id));
      setSelected(null);
    } catch (err) {
      setDialogError(err.response?.data?.message ?? 'Could not dismiss the detection. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={180} />
        <Skeleton variant="rounded" height={180} />
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (detections.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <ImageSearchOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
        <Typography color="text.secondary">No detections need manual review right now.</Typography>
      </Box>
    );
  }

  return (
    <>
      <Grid container spacing={2}>
        {detections.map((d) => (
          <Grid key={d.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Paper
              variant="outlined"
              sx={{ p: 1.5, borderRadius: 2, cursor: 'pointer' }}
              onClick={() => openReview(d)}
            >
              <BoundingBoxOverlay
                imageUrl={d.image_url}
                boundingBox={d.bounding_box}
                label={d.defect_class ?? 'unclassified'}
                alt={`Possible ${d.defect_class ?? 'defect'}`}
              />
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
                <Typography variant="body2" fontWeight={600} textTransform="capitalize">
                  {d.defect_class ?? 'Unclassified'}
                </Typography>
                <Chip label={formatConfidence(d.confidence)} size="small" color="warning" variant="outlined" />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {formatDate(d.detected_at)} · {d.source === 'resident_upload' ? 'Resident upload' : 'Scheduled scan'}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Dialog open={Boolean(selected)} onClose={closeReview} fullWidth maxWidth="xs">
        {selected && (
          <form onSubmit={handleCreateTicket}>
            <DialogTitle>Review detection</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {dialogError && <Alert severity="error">{dialogError}</Alert>}

                <BoundingBoxOverlay
                  imageUrl={selected.image_url}
                  boundingBox={selected.bounding_box}
                  label={selected.defect_class ?? 'unclassified'}
                  alt={`Possible ${selected.defect_class ?? 'defect'}`}
                  sx={{ maxHeight: 240 }}
                />
                <Typography variant="body2" color="text.secondary">
                  Automatic detection guessed <strong>{selected.defect_class ?? 'unclassified'}</strong> at{' '}
                  {formatConfidence(selected.confidence)} confidence — below the threshold for an
                  automatic ticket. Confirm what this actually is, or dismiss it as a false positive.
                </Typography>

                <TextField
                  select
                  label="Category"
                  required
                  size="small"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  disabled={busy}
                >
                  {CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </TextField>

                <TextField
                  select
                  label="Priority"
                  required
                  size="small"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  disabled={busy}
                >
                  {PRIORITIES.map((p) => (
                    <MenuItem key={p} value={p}>{p}</MenuItem>
                  ))}
                </TextField>

                <TextField
                  label="Block"
                  required
                  size="small"
                  value={form.location_block}
                  onChange={(e) => setForm({ ...form, location_block: e.target.value })}
                  disabled={busy}
                  helperText={
                    selected.location_block
                      ? 'Pre-filled from the original upload — edit if wrong'
                      : 'Not captured with this detection — enter it manually'
                  }
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleDismiss} color="inherit" disabled={busy}>
                Dismiss (not a real defect)
              </Button>
              <Button onClick={closeReview} disabled={busy}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={busy}>
                {busy ? 'Saving…' : 'Create ticket'}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
    </>
  );
}
