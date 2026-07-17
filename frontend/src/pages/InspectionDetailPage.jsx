// UC-002 manager detail + triage view. Full record from GET /api/inspections/:id
// (reporter shown by block/unit only — no name by design), a triage form that
// PATCHes status/priority/contractor/deadline, and the audit history below.
// Closing (UC-004) is a separate flow with e-signature — 'Closed' is not
// offered here. The photo column leaves room for the CV overlay (Mahdiya's).
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, useParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

// Statuses a manager may set here — everything except Closed (UC-004 flow).
const SETTABLE_STATUSES = [
  'Open', 'Pending Assignment', 'Assigned', 'Acknowledged',
  'On Hold', 'Rectified', 'Resolved',
];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function InspectionDetailPage() {
  const { id } = useParams();
  const { profile } = useAuth();

  const [inspection, setInspection] = useState(null);
  const [contractors, setContractors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Triage form state (seeded from the record once loaded).
  const [form, setForm] = useState({
    status: '', priority: '', contractor_id: '', target_deadline: '', note: '',
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null); // { severity, message }

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get(`/api/inspections/${id}`), api.get('/api/contractors')])
      .then(([insRes, conRes]) => {
        const ins = insRes.data;
        setInspection(ins);
        setContractors(conRes.data);
        setForm({
          status: ins.status === 'Closed' ? '' : ins.status,
          priority: ins.priority,
          contractor_id: ins.contractor_id ?? '',
          target_deadline: ins.target_deadline ? ins.target_deadline.slice(0, 10) : '',
          note: '',
        });
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  async function handleSave(e) {
    e.preventDefault();
    setFeedback(null);

    // Send only what changed, so the audit log reflects real actions.
    const body = {};
    if (form.status && form.status !== inspection.status) body.status = form.status;
    if (form.priority !== inspection.priority) body.priority = form.priority;
    if (form.contractor_id && form.contractor_id !== (inspection.contractor_id ?? '')) {
      body.contractor_id = form.contractor_id;
    }
    const currentDeadline = inspection.target_deadline
      ? inspection.target_deadline.slice(0, 10)
      : '';
    if (form.target_deadline && form.target_deadline !== currentDeadline) {
      body.target_deadline = new Date(form.target_deadline).toISOString();
    }
    if (Object.keys(body).length === 0) {
      setFeedback({ severity: 'info', message: 'Nothing changed.' });
      return;
    }
    if (form.note.trim()) body.note = form.note.trim();

    setSaving(true);
    try {
      await api.patch(`/api/inspections/${id}`, body);
      setFeedback({ severity: 'success', message: 'Inspection updated.' });
      load(); // refresh record + history
    } catch (err) {
      setFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Update failed. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  // UI-level guard — backend requireRole('manager') is the real enforcement.
  if (profile && profile.role !== 'manager') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 4 }, px: 2 }}>
      <Container maxWidth="lg" disableGutters>
        <Link
          component={RouterLink}
          to="/inspections"
          underline="hover"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2 }}
        >
          <ArrowBackIcon fontSize="small" /> Back to queue
        </Link>

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : loadError || !inspection ? (
          <Alert severity="error">Could not load this inspection.</Alert>
        ) : (
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
              {/* Left: the record */}
              <Paper elevation={1} sx={{ p: 3, borderRadius: 3, flex: 2, width: '100%' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Typography variant="h6" fontWeight={700} sx={{ pr: 2 }}>
                    {inspection.title}
                  </Typography>
                  <Chip size="small" variant="outlined" label={inspection.status} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {inspection.category} · Block {inspection.location_block}
                  {inspection.location_unit ? ` #${inspection.location_unit}` : ''} ·{' '}
                  {inspection.source_type.replace('_', ' ')} · score{' '}
                  {inspection.ai_priority_score ?? '—'} ·{' '}
                  {formatDateTime(inspection.created_at)}
                </Typography>

                {inspection.description && (
                  <Typography variant="body1" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                    {inspection.description}
                  </Typography>
                )}

                {inspection.photo_url && (
                  // CV bounding-box overlay (Mahdiya) can mount around this image.
                  <Box
                    component="img"
                    src={inspection.photo_url}
                    alt="Report photo"
                    sx={{ maxWidth: '100%', maxHeight: 360, borderRadius: 2, mb: 2 }}
                  />
                )}

                {inspection.gps_lat && inspection.gps_lng && (
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
                    <PlaceOutlinedIcon fontSize="small" />
                    <Typography variant="caption">
                      GPS {Number(inspection.gps_lat).toFixed(5)},{' '}
                      {Number(inspection.gps_lng).toFixed(5)}
                      {inspection.gps_accuracy_m
                        ? ` (±${Math.round(inspection.gps_accuracy_m)}m)`
                        : ''}
                      {inspection.gps_captured_at
                        ? ` · captured ${formatDateTime(inspection.gps_captured_at)}`
                        : ''}
                    </Typography>
                  </Stack>
                )}
              </Paper>

              {/* Right: triage form */}
              <Paper
                elevation={1}
                component="form"
                onSubmit={handleSave}
                sx={{ p: 3, borderRadius: 3, flex: 1, width: '100%' }}
              >
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                  Triage
                </Typography>
                <Stack spacing={2}>
                  {feedback && (
                    <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>
                      {feedback.message}
                    </Alert>
                  )}

                  <TextField
                    select label="Status" size="small" value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    helperText="Closing requires the e-signature flow (separate)"
                  >
                    {SETTABLE_STATUSES.map((s) => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select label="Priority" size="small" value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    {PRIORITIES.map((p) => (
                      <MenuItem key={p} value={p}>{p}</MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select label="Contractor" size="small" value={form.contractor_id}
                    onChange={(e) => setForm({ ...form, contractor_id: e.target.value })}
                    helperText="Assigning sets status to Assigned + 14-day deadline"
                  >
                    <MenuItem value="" disabled>Select contractor</MenuItem>
                    {contractors.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name}{c.brands_serviced ? ` (${c.brands_serviced})` : ''}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    label="Target deadline" type="date" size="small"
                    value={form.target_deadline}
                    onChange={(e) => setForm({ ...form, target_deadline: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                  />

                  <TextField
                    label="Note (audit log)" size="small" multiline minRows={2}
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                  />

                  <Button
                    type="submit" variant="contained" disabled={saving}
                    startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveOutlinedIcon />}
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </Stack>
              </Paper>
            </Stack>

            {/* Audit history */}
            <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                History
              </Typography>
              {inspection.history?.length ? (
                <Stack divider={<Divider />} spacing={1.5}>
                  {inspection.history.map((h, idx) => (
                    <Box key={idx}>
                      <Typography variant="body2">
                        <strong>{h.actor_name ?? 'Unknown'}</strong> — {h.action}
                        {h.previous_status && h.new_status && h.previous_status !== h.new_status
                          ? `: ${h.previous_status} → ${h.new_status}`
                          : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(h.created_at)}
                        {h.note ? ` · “${h.note}”` : ''}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No actions recorded yet.
                </Typography>
              )}
            </Paper>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
