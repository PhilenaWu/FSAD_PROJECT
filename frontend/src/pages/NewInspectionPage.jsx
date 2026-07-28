// Inspector lift spot-check form (UC-001, source_type 'lift_inspection').
// Fetches the lift list + checklist template, records Pass/Defect per item
// (severity + remark + optional photo on Defect), and POSTs multipart to
// /api/inspections/lift: lift_id + checklist JSON fields, plus one
// photo_<checklist_item_id> file part per photographed defect.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import CloseIcon from '@mui/icons-material/Close';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import LocationCapture from '../components/LocationCapture';
import SignaturePad from '../components/SignaturePad';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { compressImage } from '../utils/imageCompress';

const SEVERITIES = ['Minor', 'Major', 'Critical']; // checklist_results CHECK

export default function NewInspectionPage() {
  const { profile } = useAuth();

  const [lifts, setLifts] = useState([]);
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [liftId, setLiftId] = useState('');
  const [servicedAt, setServicedAt] = useState(''); // paper form's "Servicing Date"
  // answers[itemId] = { result: 'Pass'|'Defect', severity, remark }
  const [answers, setAnswers] = useState({});
  const [gps, setGps] = useState(null); // optional; never replaces lift choice
  const signaturePadRef = useRef(null); // paper form's "Checked by" box (G5)
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { severity, message }

  // Load the lift picker + checklist template once on mount.
  useEffect(() => {
    let active = true;
    Promise.all([api.get('/api/lifts'), api.get('/api/checklist-items')])
      .then(([liftsRes, itemsRes]) => {
        if (!active) return;
        setLifts(liftsRes.data);
        setItems(itemsRes.data);
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
  }, []);

  // The chosen lift's record, for the read-only header details below the picker.
  const selectedLift = useMemo(
    () => lifts.find((l) => l.id === liftId),
    [lifts, liftId]
  );

  // Group template items by section, preserving display_order within each.
  const sections = useMemo(() => {
    const bySection = new Map();
    for (const item of items) {
      if (!bySection.has(item.section)) bySection.set(item.section, []);
      bySection.get(item.section).push(item);
    }
    return [...bySection.entries()];
  }, [items]);

  function setAnswer(itemId, patch) {
    setAnswers((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  // Attach/replace a defect photo. Object URLs are created here and revoked on
  // replace/remove/reset so we don't leak blobs.
  function setPhoto(itemId, file) {
    setAnswers((prev) => {
      const old = prev[itemId]?.previewUrl;
      if (old) URL.revokeObjectURL(old);
      return {
        ...prev,
        [itemId]: {
          ...prev[itemId],
          photo: file ?? undefined,
          previewUrl: file ? URL.createObjectURL(file) : undefined,
        },
      };
    });
  }

  // Severity drives the photo rule (G3): Minor defects must not carry one, so
  // switching to Minor drops any photo already attached.
  function setSeverity(itemId, severity) {
    if (severity === 'Minor') setPhoto(itemId, null);
    setAnswer(itemId, { severity });
  }

  function resetForm() {
    for (const a of Object.values(answers)) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setLiftId('');
    setServicedAt('');
    setAnswers({});
    setGps(null);
    signaturePadRef.current?.clear();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFeedback(null);

    // Client guard mirroring the server's G1–G3 checks, so the inspector fixes
    // the problem inline rather than losing a round trip to a 400.
    const unanswered = items.filter((i) => !answers[i.id]?.result);
    const defects = items.filter((i) => answers[i.id]?.result === 'Defect');
    const noSeverity = defects.filter((i) => !answers[i.id].severity);
    const noPhoto = defects.filter(
      (i) => answers[i.id].severity && answers[i.id].severity !== 'Minor' && !answers[i.id].photo
    );

    let problem;
    if (!liftId) problem = 'Select a lift before submitting.';
    else if (!servicedAt) problem = 'Enter the servicing date before submitting.';
    else if (unanswered.length > 0)
      problem = `Answer all checklist items (${unanswered.length} remaining).`;
    else if (noSeverity.length > 0)
      problem = `Choose a severity for every defect (${noSeverity.length} still unset).`;
    else if (noPhoto.length > 0)
      problem = `Attach a photo to each Major or Critical defect (${noPhoto.length} missing).`;
    else if (signaturePadRef.current?.isEmpty())
      problem = 'Sign the "Checked by" box before submitting.';

    if (problem) {
      setFeedback({ severity: 'error', message: problem });
      return;
    }

    const checklist = items.map((i) => {
      const a = answers[i.id];
      const entry = { checklist_item_id: i.id, result: a.result };
      if (a.result === 'Defect') {
        if (a.severity) entry.severity = a.severity;
        if (a.remark?.trim()) entry.remark = a.remark.trim();
      }
      return entry;
    });

    // Multipart body: checklist travels as a JSON string field; each defect
    // photo is its own photo_<checklist_item_id> file part.
    const formData = new FormData();
    formData.append('lift_id', liftId);
    formData.append('serviced_at', servicedAt);
    formData.append('checklist', JSON.stringify(checklist));
    if (gps) {
      formData.append('gps_lat', gps.lat);
      formData.append('gps_lng', gps.lng);
      formData.append('gps_accuracy_m', gps.accuracy_m);
      formData.append('gps_captured_at', gps.captured_at);
    }
    for (const i of items) {
      const a = answers[i.id];
      if (a?.result === 'Defect' && a.photo) {
        // Compress just before upload (thumbnail still shows the original).
        formData.append(`photo_${i.id}`, await compressImage(a.photo));
      }
    }
    // The "Checked by" signature. Sent raw — the pad emits a few KB of line
    // art, well under the 100 KB cap, and compressImage expects a File.
    formData.append(
      'inspector_signature',
      await signaturePadRef.current.toBlob(),
      'inspector.png'
    );

    setSubmitting(true);
    try {
      // Let the browser set the multipart boundary; the api interceptor adds auth.
      const { data } = await api.post('/api/inspections/lift', formData);
      // G6: a clean check is filed closed with no contractor, so don't claim
      // defects were assigned.
      setFeedback({
        severity: 'success',
        message:
          data.status === 'Closed'
            ? 'Inspection submitted — no defects found, so it was filed as a compliant check.'
            : 'Inspection submitted — defects were assigned to the lift’s contractor.',
      });
      resetForm();
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'VALIDATION_ERROR' || code === 'NOT_FOUND') {
        setFeedback({ severity: 'error', message: err.response.data.message });
      } else if (code === 'FORBIDDEN') {
        setFeedback({
          severity: 'error',
          message: 'Only inspectors can submit lift inspections.',
        });
      } else {
        setFeedback({
          severity: 'error',
          message: 'Something went wrong submitting the inspection. Please try again.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // UI-level convenience guard — the backend enforces the inspector role anyway.
  if (profile && profile.role !== 'inspector') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 720 }}>
        <Typography
          variant="h4"
          component="h1"
          fontWeight={700}
          sx={{ mb: 3, color: 'primary.main', textAlign: 'center' }}
        >
          New lift inspection
        </Typography>

        <Paper elevation={2} sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
          {loading ? (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress />
            </Stack>
          ) : loadError ? (
            <Alert severity="error">
              Could not load the lift list or checklist. Refresh to try again.
            </Alert>
          ) : (
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <Stack spacing={3}>
                {feedback && (
                  <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>
                    {feedback.message}
                  </Alert>
                )}

                <TextField
                  select
                  label="Lift"
                  value={liftId}
                  onChange={(e) => setLiftId(e.target.value)}
                  required
                  fullWidth
                  helperText="Defects are assigned to the lift's maintenance contractor"
                >
                  <MenuItem value="" disabled>
                    Select lift
                  </MenuItem>
                  {lifts.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {`Block ${l.block_number} — ${l.lift_code} (${l.brand}${
                        l.contractor_name ? `, ${l.contractor_name}` : ''
                      })`}
                    </MenuItem>
                  ))}
                </TextField>

                {/* Town Council and Address from the paper form header. These
                    belong to the lift record, not the inspection, so they are
                    auto-filled from the picker and shown read-only. */}
                {selectedLift && (
                  <Stack
                    spacing={1}
                    sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}
                  >
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Town Council
                      </Typography>
                      <Typography variant="body2">
                        {selectedLift.town_council || '—'}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Address
                      </Typography>
                      <Typography variant="body2">{selectedLift.address || '—'}</Typography>
                    </Box>
                  </Stack>
                )}

                {/* Servicing Date from the paper form header — the contractor
                    visit this spot-check audits, not today's check date. */}
                <TextField
                  type="date"
                  label="Servicing date"
                  value={servicedAt}
                  onChange={(e) => setServicedAt(e.target.value)}
                  required
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                  helperText="Date the lift company serviced this lift"
                />

                {/* Optional GPS — supplements (never replaces) the lift choice. */}
                <LocationCapture value={gps} onChange={setGps} />

                {/* Checklist appears once a lift is chosen. */}
                {liftId &&
                  sections.map(([section, sectionItems]) => (
                    <Box key={section}>
                      <Typography
                        variant="subtitle2"
                        sx={{ color: 'primary.main', textTransform: 'uppercase', mb: 1 }}
                      >
                        {section}
                      </Typography>
                      <Stack divider={<Divider />} spacing={2}>
                        {sectionItems.map((item) => {
                          const a = answers[item.id] ?? {};
                          return (
                            <Box key={item.id}>
                              <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                justifyContent="space-between"
                                alignItems={{ xs: 'flex-start', sm: 'center' }}
                                spacing={1}
                              >
                                <Typography variant="body2">{item.item_text}</Typography>
                                <RadioGroup
                                  row
                                  value={a.result ?? ''}
                                  onChange={(e) => setAnswer(item.id, { result: e.target.value })}
                                >
                                  <FormControlLabel
                                    value="Pass"
                                    control={<Radio size="small" />}
                                    label="Pass"
                                  />
                                  <FormControlLabel
                                    value="Defect"
                                    control={<Radio size="small" color="primary" />}
                                    label="Defect"
                                  />
                                </RadioGroup>
                              </Stack>

                              {/* Defect details: severity (required) + remark, and
                                  a photo for Major/Critical only. */}
                              {a.result === 'Defect' && (
                                <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                                  <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={2}
                                  >
                                    <TextField
                                      select
                                      required
                                      label="Severity"
                                      size="small"
                                      value={a.severity ?? ''}
                                      onChange={(e) => setSeverity(item.id, e.target.value)}
                                      sx={{ minWidth: 160 }}
                                    >
                                      {SEVERITIES.map((s) => (
                                        <MenuItem key={s} value={s}>
                                          {s}
                                        </MenuItem>
                                      ))}
                                    </TextField>
                                    <TextField
                                      label="Remark"
                                      size="small"
                                      value={a.remark ?? ''}
                                      onChange={(e) =>
                                        setAnswer(item.id, { remark: e.target.value })
                                      }
                                      fullWidth
                                    />
                                  </Stack>

                                  {/* G3: Minor defects are remark-only — the
                                      client's "no photos on minor issue" rule. */}
                                  {a.severity === 'Minor' && (
                                    <Typography variant="caption" color="text.secondary">
                                      Minor defects are recorded by remark only — no photo.
                                    </Typography>
                                  )}

                                  {/* Compact per-item photo picker (thumbnail +
                                      remove, like ReportIssuePage's, scaled down).
                                      Required once severity is Major/Critical. */}
                                  {a.severity && a.severity !== 'Minor' && (
                                    a.previewUrl ? (
                                    <Stack
                                      direction="row"
                                      spacing={1.5}
                                      alignItems="center"
                                      sx={{
                                        p: 1,
                                        border: 1,
                                        borderColor: 'divider',
                                        borderRadius: 2,
                                      }}
                                    >
                                      <Box
                                        component="img"
                                        src={a.previewUrl}
                                        alt="Defect photo preview"
                                        sx={{
                                          width: 48,
                                          height: 48,
                                          objectFit: 'cover',
                                          borderRadius: 1,
                                        }}
                                      />
                                      <Typography
                                        variant="caption"
                                        sx={{ flexGrow: 1, wordBreak: 'break-all' }}
                                      >
                                        {a.photo?.name}
                                      </Typography>
                                      <IconButton
                                        aria-label="Remove photo"
                                        onClick={() => setPhoto(item.id, null)}
                                        size="small"
                                      >
                                        <CloseIcon fontSize="small" />
                                      </IconButton>
                                    </Stack>
                                  ) : (
                                    <Box
                                      component="label"
                                      sx={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                        alignSelf: 'flex-start',
                                        px: 1.5,
                                        py: 0.75,
                                        border: '1px dashed',
                                        borderColor: 'divider',
                                        borderRadius: 2,
                                        cursor: 'pointer',
                                        color: 'text.secondary',
                                        fontSize: 13,
                                        '&:hover': {
                                          borderColor: 'primary.main',
                                          color: 'primary.main',
                                        },
                                      }}
                                    >
                                      <input
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={(e) => {
                                          const chosen = e.target.files?.[0];
                                          if (chosen) setPhoto(item.id, chosen);
                                          e.target.value = '';
                                        }}
                                      />
                                      <AddPhotoAlternateOutlinedIcon fontSize="small" />
                                      Add photo
                                    </Box>
                                    )
                                  )}
                                </Stack>
                              )}
                            </Box>
                          );
                        })}
                      </Stack>
                    </Box>
                  ))}

                {/* G5 — the paper form's "Checked by / Signature" box. Shown
                    with the checklist, since it attests to those answers. */}
                {liftId && (
                  <SignaturePad
                    ref={signaturePadRef}
                    label={`Checked by — ${profile?.full_name ?? 'inspector'}`}
                  />
                )}

                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="large"
                  disabled={submitting}
                  startIcon={
                    submitting ? (
                      <CircularProgress size={18} color="inherit" />
                    ) : (
                      <SendOutlinedIcon />
                    )
                  }
                  sx={{ alignSelf: 'flex-start', px: 4 }}
                >
                  {submitting ? 'Submitting…' : 'Submit inspection'}
                </Button>

                <Typography variant="caption" color="text.secondary">
                  Select a lift, enter the servicing date, mark every checklist
                  item, and sign. Severity and remarks apply to defects only.
                </Typography>
              </Stack>
            </Box>
          )}
        </Paper>
      </Container>
    </Box>
  );
}
