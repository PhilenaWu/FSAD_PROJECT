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
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SignaturePad from '../components/SignaturePad';
import BoundingBoxOverlay from '../components/cv/BoundingBoxOverlay';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { priorityDisplay } from '../utils/priorityDisplay';
import { PRIORITIES } from '../utils/inspectionOptions';
import { nearestBlock } from '../utils/blocks';

// Statuses a manager may set here — everything except Closed (UC-004 flow).
const SETTABLE_STATUSES = [
  'Open', 'Pending Assignment', 'Assigned', 'Acknowledged',
  'On Hold', 'Rectified', 'Resolved',
];

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

// One side of the before/after pair. Renders a labelled placeholder when the
// photo is absent, so "no completion proof yet" is visible rather than implied
// by a missing element.
function PhotoSlot({ label, url }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      {url ? (
        <Box
          component="img"
          src={url}
          alt={label}
          sx={{
            width: '100%',
            maxHeight: 200,
            objectFit: 'cover',
            borderRadius: 2,
            display: 'block',
          }}
        />
      ) : (
        <Stack
          alignItems="center"
          justifyContent="center"
          spacing={0.5}
          sx={{
            height: 120,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 2,
            color: 'text.secondary',
          }}
        >
          <ImageNotSupportedOutlinedIcon fontSize="small" />
          <Typography variant="caption">Not submitted</Typography>
        </Stack>
      )}
    </Box>
  );
}

export default function InspectionDetailPage() {
  const { id } = useParams();
  const { profile } = useAuth();
  // Inspectors get a read-only view — triage form, reject, and close are hidden.
  const isInspector = profile?.role === 'inspector';

  const [inspection, setInspection] = useState(null);
  const [contractors, setContractors] = useState([]);
  const [inspectors, setInspectors] = useState([]); // endorser candidates (G7)
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
  const [closeForm, setCloseForm] = useState({
    closing_remark: '',
    actual_cost: '',
    waiver_note: '', // G8: only sent when defects remain unrectified
  });
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false); // freezes the panel post-success
  const [closeFeedback, setCloseFeedback] = useState(null);
  const managerPadRef = useRef(null);
  const endorserPadRef = useRef(null);

  // Reject panel state (UC-004 Alt 4).
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState(null);

  // Inspector's read-only "mark as reviewed" panel — an audit note only, no
  // status change or accept/close authority (that stays with the manager).
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState(null);

  // A closed record (manual close or the G6 zero-defect auto-file) is archived
  // and read-only: the triage form and close panel would otherwise render as
  // live-looking controls that 404 on submit, since the backend's mutation
  // guards independently reject an already-archived record.
  const archived = inspection?.is_deleted === true;

  // Defect rows drive the endorsement panel; `outstandingItems` mirrors the
  // server's G8 gate so the manager sees what blocks the close before trying.
  const defectResults = useMemo(
    () => (inspection?.checklist_results ?? []).filter((r) => r.result === 'Defect'),
    [inspection]
  );
  const outstandingItems = useMemo(
    () =>
      defectResults
        .filter((r) => !r.rectified || !r.completion_photo_url)
        .map((r) => r.display_order),
    [defectResults]
  );

  // Second endorser for the dual e-signature. G7/R9: the endorsing signature
  // must belong to an inspector — the client asked for sign-off from EM
  // Services, so the contractor who did the work can't endorse it. Defaults to
  // the record's own inspector where there is one (lift spot-checks); resident
  // complaints have none, so the manager nominates any active inspector.
  // Empty selection → close stays disabled with an explanatory note.
  const [endorserId, setEndorserId] = useState('');
  const endorser = useMemo(() => {
    const chosen = inspectors.find((i) => i.id === endorserId);
    if (!chosen) return null;
    return { role: 'inspector', id: chosen.id, label: chosen.full_name ?? chosen.email };
  }, [inspectors, endorserId]);

  const load = useCallback(() => {
    setLoading(true);
    // Inspectors are read-only and can't reach the manager-only /contractors
    // and /users/inspectors endpoints, so skip fetching them entirely.
    const requests = isInspector
      ? [api.get(`/api/inspections/${id}`)]
      : [
          api.get(`/api/inspections/${id}`),
          api.get('/api/contractors'),
          api.get('/api/users/inspectors'),
        ];
    Promise.all(requests)
      .then(([insRes, conRes, inspRes]) => {
        const ins = insRes.data;
        setInspection(ins);
        if (conRes) setContractors(conRes.data);
        if (inspRes) setInspectors(inspRes.data);
        // Default the endorser to the record's own inspector when it has one
        // (lift spot-checks); the manager can still nominate a different one.
        if (ins.inspector_id && inspRes?.data.some((i) => i.id === ins.inspector_id)) {
          setEndorserId(ins.inspector_id);
        }
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
  }, [id, isInspector]);

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
      if (outstandingItems.length > 0) {
        formData.append('waiver_note', closeForm.waiver_note.trim());
      }
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
      // The record is gone from all active lists (though this page still opens
      // it read-only), so take the manager back to the queue rather than
      // leaving them on a form that no longer applies.
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

  // Send the record back to the contractor with a reason (UC-004 Alt 4).
  async function handleReject() {
    setRejectFeedback(null);
    if (rejectReason.trim().length < 10) {
      setRejectFeedback({
        severity: 'error',
        message: 'Rejection reason must be at least 10 characters.',
      });
      return;
    }

    setRejecting(true);
    try {
      await api.post(`/api/inspections/${id}/reject`, { reason: rejectReason.trim() });
      setRejectReason('');
      setRejectFeedback({
        severity: 'success',
        message: 'Sent back to the contractor with a fresh 14-day deadline.',
      });
      load(); // status, reopen_count and the cleared proofs all change
    } catch (err) {
      setRejectFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Could not reject. Please try again.',
      });
    } finally {
      setRejecting(false);
    }
  }

  // Inspector confirms they've looked over a Rectified record. Writes an
  // audit-trail row only — no status change, no accept/close authority.
  async function handleReview() {
    setReviewFeedback(null);
    setReviewing(true);
    try {
      await api.post(`/api/inspections/${id}/review`, { note: reviewNote.trim() });
      setReviewNote('');
      setReviewFeedback({ severity: 'success', message: 'Marked as reviewed.' });
      load(); // refresh history so the new entry shows up below
    } catch (err) {
      setReviewFeedback({
        severity: 'error',
        message: err.response?.data?.message ?? 'Could not mark as reviewed. Please try again.',
      });
    } finally {
      setReviewing(false);
    }
  }

  // UI-level guard — backend requireRole('manager', 'inspector') is the real
  // enforcement.
  if (profile && profile.role !== 'manager' && profile.role !== 'inspector') {
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
            {archived && (
              <Alert severity="info">
                This record is closed and archived — read only.
              </Alert>
            )}

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
                          label={`Detected: ${inspection.cv_detection.defect_class ?? 'unclassified'} · ${Math.round(
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

                {/* Lead with the nearest block: whoever reads this is at a desk
                    and cannot check the coordinates against the estate. The raw
                    lat/lng stays — this record is the audit trail, and the
                    block is only derived from it. */}
                {inspection.gps_lat && inspection.gps_lng && (
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
                    <PlaceOutlinedIcon fontSize="small" />
                    <Typography variant="caption">
                      Near Block{' '}
                      {nearestBlock({
                        lat: Number(inspection.gps_lat),
                        lng: Number(inspection.gps_lng),
                      })}{' '}
                      · GPS {Number(inspection.gps_lat).toFixed(5)},{' '}
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

              {/* Right: triage form — manager-only, inspectors are read-only.
                  Archived records render a static summary instead: PATCHing a
                  closed record 404s server-side, so an editable form here
                  would look live but fail silently on submit. */}
              {!isInspector && archived && (
                <Paper elevation={1} sx={{ p: 3, borderRadius: 3, flex: 1, width: '100%' }}>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                    Triage (archived)
                  </Typography>
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Status
                      </Typography>
                      <Typography variant="body2">{inspection.status}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Priority
                      </Typography>
                      <Typography variant="body2">{inspection.priority}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Contractor
                      </Typography>
                      <Typography variant="body2">
                        {contractors.find((c) => c.id === inspection.contractor_id)?.name ?? '—'}
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              )}
              {!isInspector && !archived && (
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
                        {/* Vendors onboarded without an explicit brand get the
                            company name as their brand, so only append it when
                            it actually adds something — otherwise this reads
                            "FPTD Services (FPTD Services)". */}
                        {c.name}
                        {c.brands_serviced && c.brands_serviced !== c.name
                          ? ` (${c.brands_serviced})`
                          : ''}
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
              )}
            </Stack>

            {/* Joint endorsement (UC-004 / P.13): the checklist as inspected,
                with each defect's original photo beside the contractor's
                completion proof, so the manager endorses what they can see. */}
            {inspection.checklist_results?.length > 0 && (
              <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 0.5 }}
                >
                  <Typography variant="subtitle1" fontWeight={700}>
                    Spot-check results
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    {inspection.reopen_count > 0 && (
                      <Chip
                        size="small"
                        color="warning"
                        label={`Re-opened ×${inspection.reopen_count}`}
                      />
                    )}
                    <Chip
                      size="small"
                      variant="outlined"
                      color={defectResults.length > 0 ? 'error' : 'success'}
                      label={
                        defectResults.length > 0
                          ? `${defectResults.length} defect${defectResults.length > 1 ? 's' : ''}`
                          : 'All items passed'
                      }
                    />
                  </Stack>
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 2 }}
                >
                  {outstandingItems.length > 0
                    ? `Item(s) ${outstandingItems.join(', ')} still need a completion photo before this can be closed.`
                    : 'Every defect has been rectified with a completion photo.'}
                </Typography>

                <Stack divider={<Divider />} spacing={2}>
                  {defectResults.map((r) => (
                    <Box key={r.id}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ mb: 1 }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          {r.display_order}. {r.item_text}
                        </Typography>
                        {r.severity && (
                          <Chip
                            size="small"
                            color={r.severity === 'Minor' ? 'default' : 'error'}
                            label={r.severity}
                          />
                        )}
                        <Chip
                          size="small"
                          variant="outlined"
                          color={r.rectified && r.completion_photo_url ? 'success' : 'warning'}
                          label={
                            r.rectified && r.completion_photo_url
                              ? 'Rectified'
                              : 'Awaiting rectification'
                          }
                        />
                      </Stack>

                      {r.remark && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          Inspector: {r.remark}
                        </Typography>
                      )}
                      {r.completion_remark && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          Contractor: {r.completion_remark}
                        </Typography>
                      )}

                      {/* Before ⟷ after. Both sides always render so a missing
                          completion photo reads as an absence, not an omission. */}
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <PhotoSlot label="Defect" url={r.photo_url} />
                        <PhotoSlot label="Completion proof" url={r.completion_photo_url} />
                      </Stack>
                    </Box>
                  ))}
                </Stack>

                {/* Reject (UC-004 Alt 4) — only meaningful once the contractor
                    has claimed the work is done. Manager-only; inspectors are
                    read-only here. */}
                {!isInspector && inspection.status === 'Rectified' && (
                  <Box sx={{ mt: 3 }}>
                    <Divider sx={{ mb: 2 }} />
                    {rejectFeedback && (
                      <Alert
                        severity={rejectFeedback.severity}
                        onClose={() => setRejectFeedback(null)}
                        sx={{ mb: 2 }}
                      >
                        {rejectFeedback.message}
                      </Alert>
                    )}
                    <Stack spacing={1.5}>
                      <TextField
                        label="Rejection reason"
                        size="small"
                        multiline
                        minRows={2}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        helperText="At least 10 characters — shown to the contractor and recorded in the audit trail"
                      />
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={handleReject}
                        disabled={rejecting}
                        startIcon={
                          rejecting ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <ReplayOutlinedIcon />
                          )
                        }
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {rejecting ? 'Sending back…' : 'Reject rectification'}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        Sends the record back to the contractor as Assigned with a
                        fresh 14-day deadline. Signatures already collected are kept.
                      </Typography>
                    </Stack>
                  </Box>
                )}
              </Paper>
            )}

            {/* Close record (UC-004) — terminal action, visually distinct from
                the triage card: outlined with the error accent, not elevated.
                Manager-only; inspectors are read-only here. Hidden once
                archived — the record is already closed, and closing it again
                would 404 server-side. */}
            {!isInspector && !archived && (
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

                {/* G8: closing over unrectified defects is allowed, but only as
                    an explicit, recorded exception. */}
                {outstandingItems.length > 0 && (
                  <>
                    <Alert severity="warning">
                      Item(s) {outstandingItems.join(', ')} have no completion photo.
                      Closing now requires a waiver note explaining why.
                    </Alert>
                    <TextField
                      label="Waiver note"
                      size="small"
                      multiline
                      minRows={2}
                      required
                      value={closeForm.waiver_note}
                      onChange={(e) =>
                        setCloseForm({ ...closeForm, waiver_note: e.target.value })
                      }
                      helperText="At least 10 characters — appended to the closing remark for the audit trail"
                      disabled={closed}
                    />
                  </>
                )}

                {/* G7: pick who endorses before signing, so the pad below is
                    labelled with the inspector actually signing off. */}
                {inspectors.length === 0 ? (
                  <Alert severity="warning">
                    No active inspector account exists — dual endorsement requires
                    one (G7). Closing is disabled until an inspector is available.
                  </Alert>
                ) : (
                  <TextField
                    select
                    required
                    label="Endorsing inspector"
                    size="small"
                    value={endorserId}
                    onChange={(e) => setEndorserId(e.target.value)}
                    helperText="The EM Services inspector signing off on this closure"
                    disabled={closed}
                  >
                    {inspectors.map((i) => (
                      <MenuItem key={i.id} value={i.id}>
                        {i.full_name ?? i.email}
                      </MenuItem>
                    ))}
                  </TextField>
                )}

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
            )}

            {/* Inspector's read-only "mark as reviewed" — an audit note only;
                accept/reject/close stay with the manager's panel above. Only
                relevant once the record is actually awaiting endorsement —
                not for an inspector's own not-yet-rectified past inspections. */}
            {isInspector && inspection.status === 'Rectified' && (
              <Paper elevation={1} sx={{ p: 3, borderRadius: 3 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <CheckCircleOutlineIcon color="success" />
                  <Typography variant="subtitle1" fontWeight={700}>
                    Mark as reviewed
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  Confirms you've checked this completed work. Recorded in the history
                  below — the manager still handles accept/reject and closing.
                </Typography>
                <Stack spacing={2}>
                  {reviewFeedback && (
                    <Alert severity={reviewFeedback.severity} onClose={() => setReviewFeedback(null)}>
                      {reviewFeedback.message}
                    </Alert>
                  )}
                  <TextField
                    label="Note (optional)"
                    size="small"
                    multiline
                    minRows={2}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                  <Button
                    variant="contained"
                    color="success"
                    onClick={handleReview}
                    disabled={reviewing}
                    startIcon={
                      reviewing ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <CheckCircleOutlineIcon />
                      )
                    }
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {reviewing ? 'Saving…' : 'Mark as reviewed'}
                  </Button>
                </Stack>
              </Paper>
            )}

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
