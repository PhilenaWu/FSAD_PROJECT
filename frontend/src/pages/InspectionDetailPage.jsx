// UC-002 manager detail + triage view. Full record from GET /api/inspections/:id
// (reporter shown by block/unit only — no name by design), a triage form that
// PATCHes status/priority/contractor/deadline, and the audit history below.
// Closing (UC-004) is a separate flow with e-signature — 'Closed' is not
// offered here. The photo column leaves room for the CV overlay (Mahdiya's).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, Navigate, useNavigate, useParams } from 'react-router';
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
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import SignaturePad from '../components/SignaturePad';
import BoundingBoxOverlay from '../components/cv/BoundingBoxOverlay';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { priorityDisplay } from '../utils/priorityDisplay';

// Statuses a manager may set here — everything except Closed (UC-004 flow).
const SETTABLE_STATUSES = [
  'Open', 'Pending Assignment', 'Assigned', 'Acknowledged',
  'On Hold', 'Rectified', 'Resolved',
];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// Make the triage controls read as controls against the white card: tinted
// input background, hover/focus border feedback (standard MUI outlined
// conventions, made explicit).
const controlSx = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'background.default',
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'text.secondary' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.main' },
  },
};

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

  // Close panel state (UC-004). Separate from triage — closing is terminal.
  const navigate = useNavigate();
  const [closeForm, setCloseForm] = useState({ closing_remark: '', actual_cost: '' });
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false); // freezes the panel post-success
  const [closeFeedback, setCloseFeedback] = useState(null);
  const managerPadRef = useRef(null);
  const endorserPadRef = useRef(null);

  // Second endorser for the dual e-signature, derived from the record:
  // the inspector if there is one, else the assigned contractor's linked login.
  // Null → close stays disabled with an explanatory note (never hidden).
  const endorser = useMemo(() => {
    if (!inspection) return null;
    if (inspection.inspector_id) {
      return { role: 'inspector', id: inspection.inspector_id, label: 'Inspector' };
    }
    const assigned = contractors.find((c) => c.id === inspection.contractor_id);
    if (assigned?.user_id) {
      return { role: 'contractor', id: assigned.user_id, label: assigned.name };
    }
    return null;
  }, [inspection, contractors]);

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
    if (form.target_deadline !== currentDeadline) {
      // Blank goes to the backend as '' so it applies the 14-day default
      // instead of the field simply being ignored.
      body.target_deadline = form.target_deadline
        ? new Date(form.target_deadline).toISOString()
        : '';
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

  // UC-004: close with remark + dual e-signature. Client guards mirror the
  // backend's validation (same messages); the backend re-validates everything.
  async function handleClose(e) {
    e.preventDefault();
    setCloseFeedback(null);

    if (!closeForm.closing_remark || closeForm.closing_remark.trim().length < 10) {
      setCloseFeedback({
        severity: 'error',
        message: 'Closing remark must be at least 10 characters.',
      });
      return;
    }
    let cost;
    if (closeForm.actual_cost !== '') {
      cost = Number(closeForm.actual_cost);
      if (Number.isNaN(cost) || cost < 0) {
        setCloseFeedback({
          severity: 'error',
          message: 'actual_cost must be a non-negative number.',
        });
        return;
      }
    }
    if (managerPadRef.current?.isEmpty() || endorserPadRef.current?.isEmpty()) {
      setCloseFeedback({
        severity: 'error',
        message: 'Both signatures are required before closing.',
      });
      return;
    }

    setClosing(true);
    try {
      const [managerBlob, endorserBlob] = await Promise.all([
        managerPadRef.current.toBlob(),
        endorserPadRef.current.toBlob(),
      ]);
      const formData = new FormData();
      formData.append('closing_remark', closeForm.closing_remark.trim());
      if (cost !== undefined) formData.append('actual_cost', cost);
      formData.append('endorser_role', endorser.role);
      formData.append('endorser_id', endorser.id);
      formData.append('manager_signature', managerBlob, 'manager.png');
      formData.append('endorser_signature', endorserBlob, 'endorser.png');

      await api.post(`/api/inspections/${id}/close`, formData);
      setClosed(true);
      setCloseFeedback({
        severity: 'success',
        message: 'Record closed and archived — it has left the active queue. Returning…',
      });
      // The record now 404s on this page and is gone from all active lists, so
      // take the manager back to the queue rather than stranding them here.
      setTimeout(() => navigate('/inspections'), 1600);
    } catch (err) {
      setCloseFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Close failed. Please try again.',
      });
    } finally {
      setClosing(false);
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
            {/* Stretch (default) keeps the two cards equal height on desktop. */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              {/* Left: the record — flex column so fallbacks can fill the space. */}
              <Paper
                elevation={1}
                sx={{
                  p: 3, borderRadius: 3, flex: 2, width: '100%',
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Typography variant="h6" fontWeight={700} sx={{ pr: 2 }}>
                    {inspection.title}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Chip
                      size="small"
                      label={priorityDisplay(inspection.priority).label}
                      sx={{
                        bgcolor: priorityDisplay(inspection.priority).bg,
                        color: priorityDisplay(inspection.priority).fg,
                        fontWeight: 600,
                      }}
                    />
                    <Chip size="small" variant="outlined" label={inspection.status} />
                  </Stack>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {inspection.category} · Block {inspection.location_block}
                  {inspection.location_unit ? ` #${inspection.location_unit}` : ''} ·{' '}
                  {inspection.source_type.replace('_', ' ')} · score{' '}
                  {inspection.ai_priority_score ?? '—'} ·{' '}
                  {formatDateTime(inspection.created_at)}
                </Typography>

                {inspection.description ? (
                  <Typography variant="body1" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                    {inspection.description}
                  </Typography>
                ) : (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2, fontStyle: 'italic' }}
                  >
                    No description provided.
                  </Typography>
                )}

                {inspection.photo_url ? (
                  // CV bounding-box overlay (UC-007): draws the detected defect
                  // region when this record has a linked cv_detection (e.g. an
                  // auto-detected ticket); otherwise renders as a plain photo.
                  <Box sx={{ mb: 2 }}>
                    <BoundingBoxOverlay
                      imageUrl={inspection.photo_url}
                      boundingBox={inspection.cv_detection?.bounding_box}
                      label={inspection.cv_detection?.defect_class}
                      alt="Report photo"
                      sx={{ maxHeight: 360, borderRadius: 2 }}
                    />
                    {inspection.cv_detection && (
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={inspection.cv_detection.status === 'low_confidence' ? 'warning' : 'default'}
                          icon={<AutoAwesomeOutlinedIcon fontSize="small" />}
                          label={`CV: ${inspection.cv_detection.defect_class ?? 'unclassified'} · ${Math.round(
                            Number(inspection.cv_detection.confidence) * 100
                          )}% confidence`}
                        />
                        {inspection.cv_detection.status === 'low_confidence' && (
                          <Typography variant="caption" color="warning.main">
                            Needs manual review
                          </Typography>
                        )}
                      </Stack>
                    )}
                  </Box>
                ) : (
                  // Placeholder fills the space so the card stays balanced next
                  // to the triage panel when there's no photo.
                  <Box
                    sx={{
                      flexGrow: 1,
                      minHeight: 160,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      border: '1px dashed',
                      borderColor: 'divider',
                      borderRadius: 2,
                      color: 'text.secondary',
                      mb: 2,
                    }}
                  >
                    <ImageNotSupportedOutlinedIcon />
                    <Typography variant="caption">No photo attached</Typography>
                  </Box>
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
                    sx={controlSx}
                  >
                    {SETTABLE_STATUSES.map((s) => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select label="Priority" size="small" value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    sx={controlSx}
                  >
                    {PRIORITIES.map((p) => (
                      <MenuItem key={p} value={p}>{p}</MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select label="Contractor" size="small" value={form.contractor_id}
                    onChange={(e) => setForm({ ...form, contractor_id: e.target.value })}
                    helperText="Assigning sets status to Assigned + 14-day deadline"
                    sx={controlSx}
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
                    helperText="Leave blank for the default 14-day deadline"
                    sx={controlSx}
                  />

                  <TextField
                    label="Note (audit log)" size="small" multiline minRows={2}
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    sx={controlSx}
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

            {/* Close record (UC-004) — terminal action, visually distinct from
                the triage card: outlined with the error accent, not elevated. */}
            <Paper
              variant="outlined"
              component="form"
              onSubmit={handleClose}
              sx={{ p: 3, borderRadius: 3, borderColor: 'error.main' }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <ArchiveOutlinedIcon color="error" />
                <Typography variant="subtitle1" fontWeight={700}>
                  Close record
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                Closing is final: the record is archived to the 5-year audit trail and
                leaves all active queues. Requires a remark and dual e-signature.
              </Typography>

              <Stack spacing={2}>
                {closeFeedback && (
                  <Alert
                    severity={closeFeedback.severity}
                    onClose={() => setCloseFeedback(null)}
                  >
                    {closeFeedback.message}
                  </Alert>
                )}

                <TextField
                  label="Closing remark"
                  size="small"
                  multiline
                  minRows={2}
                  required
                  value={closeForm.closing_remark}
                  onChange={(e) =>
                    setCloseForm({ ...closeForm, closing_remark: e.target.value })
                  }
                  helperText="At least 10 characters — recorded in the audit trail"
                  disabled={closed}
                />

                <TextField
                  label="Actual cost (optional)"
                  size="small"
                  type="number"
                  inputProps={{ min: 0, step: '0.01' }}
                  value={closeForm.actual_cost}
                  onChange={(e) =>
                    setCloseForm({ ...closeForm, actual_cost: e.target.value })
                  }
                  sx={{ maxWidth: 220 }}
                  disabled={closed}
                />

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box sx={{ flex: 1 }}>
                    <SignaturePad
                      ref={managerPadRef}
                      label={`Manager signature — ${profile?.full_name ?? 'you'}`}
                    />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <SignaturePad
                      ref={endorserPadRef}
                      label={`Endorser signature — ${endorser?.label ?? 'unavailable'}`}
                    />
                  </Box>
                </Stack>

                {!endorser && (
                  <Alert severity="warning">
                    No valid endorser yet — dual endorsement needs this record's
                    inspector, or an assigned contractor with a login (see
                    backend/scripts/seed-demo-contractor.md). Closing is disabled
                    until one is available.
                  </Alert>
                )}

                <Button
                  type="submit"
                  variant="contained"
                  color="error"
                  disabled={!endorser || closing || closed}
                  startIcon={
                    closing ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <ArchiveOutlinedIcon />
                    )
                  }
                  sx={{ alignSelf: 'flex-start', px: 3 }}
                >
                  {closing ? 'Closing…' : 'Close & archive record'}
                </Button>
              </Stack>
            </Paper>

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
