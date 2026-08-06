// UC-001 "Report an issue" page. Residents file a complaint (optional photo,
// optional voice dictation into Description) via POST /api/inspections.
// Category/priority are set by the backend AI.
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import CloseIcon from '@mui/icons-material/Close';
import MicIcon from '@mui/icons-material/Mic';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import StopIcon from '@mui/icons-material/Stop';
import LocationCapture from '../components/LocationCapture';
import api from '../services/api';
import { compressImage } from '../utils/imageCompress';
import {
  VOICE_LANGUAGES,
  isSpeechSupported,
  startRecognition,
} from '../services/voiceService';

// Placeholder block list until a real blocks source exists.
const BLOCKS = ['44A', '44B', '44C', '45A', '45B'];

// Small decorative header illustration — purely visual, no data.
function ReportIllustration() {
  return (
    <Box component="svg" viewBox="0 0 160 130" sx={{ width: 140, height: 114, display: { xs: 'none', sm: 'block' } }}>
      <circle cx="34" cy="40" r="24" fill="#DBEAFE" />
      <circle cx="128" cy="30" r="16" fill="#E0E7FF" />
      <rect x="10" y="60" width="34" height="20" rx="4" fill="#E5E7EB" />
      <rect x="120" y="66" width="30" height="18" rx="4" fill="#E5E7EB" />
      <rect x="56" y="18" width="48" height="86" rx="8" fill="#2563EB" />
      <rect x="63" y="30" width="34" height="8" rx="2" fill="#ffffff" />
      <path d="M64 50 l4 4 8-8" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="80" y="49" width="17" height="3" rx="1.5" fill="#ffffff" />
      <path d="M64 64 l4 4 8-8" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="80" y="63" width="17" height="3" rx="1.5" fill="#ffffff" />
      <path d="M64 78 l4 4 8-8" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="80" y="77" width="17" height="3" rx="1.5" fill="#ffffff" />
      <circle cx="112" cy="90" r="16" fill="#D97706" />
      <path d="M112 82v10" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="112" cy="97" r="1.6" fill="#ffffff" />
    </Box>
  );
}

export default function ReportIssuePage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [block, setBlock] = useState('');
  const [unit, setUnit] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [gps, setGps] = useState(null); // optional; never replaces block/unit
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { severity, message }
  const [dragOver, setDragOver] = useState(false);

  // Voice dictation (Web Speech API). Finalised chunks are appended into the
  // Description field; the in-progress guess shows as a live caption.
  const voiceSupported = isSpeechSupported();
  const [voiceLang, setVoiceLang] = useState('en-SG');
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef(null);

  // Stop listening if the user navigates away mid-recording.
  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function toggleVoice() {
    if (recording) {
      recognitionRef.current?.stop(); // onEnd resets the state below
      return;
    }
    const recognition = startRecognition({
      lang: voiceLang,
      onResult: (finalChunk, interimText) => {
        if (finalChunk) {
          const chunk = finalChunk.trim();
          setDescription((prev) => (prev ? `${prev.trimEnd()} ${chunk}` : chunk));
        }
        setInterim(interimText);
      },
      onEnd: () => {
        setRecording(false);
        setInterim('');
        recognitionRef.current = null;
      },
    });
    if (recognition) {
      recognitionRef.current = recognition;
      setRecording(true);
    }
  }

  // Keep an object URL for the chosen photo; revoke it whenever it changes or on
  // unmount so we don't leak blob URLs.
  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function resetForm() {
    setTitle('');
    setDescription('');
    setBlock('');
    setUnit('');
    setFile(null);
    setGps(null);
  }

  function handleFileChange(e) {
    const chosen = e.target.files?.[0];
    if (chosen) setFile(chosen);
    // Allow re-selecting the same file later.
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const chosen = e.dataTransfer.files?.[0];
    if (chosen) setFile(chosen);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    recognitionRef.current?.stop(); // don't transcribe past submission
    setFeedback(null);

    // Light client guard mirroring the backend's required fields.
    if (!title.trim() || !block) {
      setFeedback({ severity: 'error', message: 'Title and block are required.' });
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('location_block', block);
    if (unit.trim()) formData.append('location_unit', unit);
    // Compress just before upload (preview still shows the original).
    if (file) formData.append('photo', await compressImage(file));
    if (gps) {
      formData.append('gps_lat', gps.lat);
      formData.append('gps_lng', gps.lng);
      formData.append('gps_accuracy_m', gps.accuracy_m);
      formData.append('gps_captured_at', gps.captured_at);
    }

    setSubmitting(true);
    try {
      // Let the browser set the multipart boundary; the api interceptor adds auth.
      await api.post('/api/inspections', formData);
      setFeedback({
        severity: 'success',
        message: 'Report submitted — category and priority will be set automatically.',
      });
      resetForm();
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'VALIDATION_ERROR') {
        setFeedback({ severity: 'error', message: err.response.data.message });
      } else if (code === 'PHOTO_TOO_LARGE') {
        setFeedback({
          severity: 'error',
          message:
            'That photo is too large even after compression. Try a smaller or less detailed image.',
        });
      } else if (code === 'DUPLICATE_SUBMISSION') {
        setFeedback({
          severity: 'warning',
          message: 'You just submitted this — please wait before resubmitting.',
        });
      } else {
        setFeedback({
          severity: 'error',
          message: 'Something went wrong submitting your report. Please try again.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <Box sx={{ maxWidth: 900, mx: 'auto' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
          <Box>
            <Typography variant="h4" component="h1" fontWeight={700}>
              Report an issue
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Tell us about the defect so we can resolve it quickly.
            </Typography>
          </Box>
          <ReportIllustration />
        </Stack>

        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={3}>
              {feedback && (
                <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>
                  {feedback.message}
                </Alert>
              )}

              <TextField
                label="Title"
                placeholder="E.g. Lift door not closing properly"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                fullWidth
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <DescriptionOutlinedIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <TextField
                label="Description"
                placeholder="Describe the issue in detail and exactly where it is."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                fullWidth
                multiline
                minRows={4}
                helperText="Provide as much detail as possible, e.g. Level 3 lift lobby, near lift A."
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start" sx={{ alignSelf: 'flex-start', mt: 1.5 }}>
                        <EditOutlinedIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              {/* Voice dictation: pick a language, tap to talk, tap to stop.
                  Transcript lands in Description (still editable). */}
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'background.default' }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  Voice language
                </Typography>
                <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                  <TextField
                    select
                    size="small"
                    value={voiceLang}
                    onChange={(e) => setVoiceLang(e.target.value)}
                    disabled={recording || !voiceSupported}
                    sx={{ minWidth: 180, bgcolor: 'background.paper' }}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <PublicOutlinedIcon fontSize="small" color="action" />
                          </InputAdornment>
                        ),
                      },
                    }}
                  >
                    {VOICE_LANGUAGES.map((l) => (
                      <MenuItem key={l.code} value={l.code}>
                        {l.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <IconButton
                    aria-label={recording ? 'Stop dictation' : 'Start dictation'}
                    onClick={toggleVoice}
                    disabled={!voiceSupported}
                    sx={{
                      color: recording ? 'primary.contrastText' : 'primary.main',
                      bgcolor: recording ? 'primary.main' : 'background.paper',
                      border: 1,
                      borderColor: 'primary.main',
                      '&:hover': {
                        bgcolor: recording
                          ? 'primary.dark'
                          : (theme) => alpha(theme.palette.primary.main, 0.08),
                      },
                    }}
                  >
                    {recording ? <StopIcon /> : <MicIcon />}
                  </IconButton>
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {!voiceSupported
                      ? 'Voice input not supported in this browser'
                      : recording
                        ? interim
                          ? `Listening… "${interim}"`
                          : 'Listening…'
                        : 'Tap the mic to dictate your description'}
                  </Typography>
                </Stack>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Block"
                  value={block}
                  onChange={(e) => setBlock(e.target.value)}
                  required
                  fullWidth
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <ApartmentOutlinedIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                    },
                  }}
                >
                  <MenuItem value="" disabled>
                    Select block
                  </MenuItem>
                  {BLOCKS.map((b) => (
                    <MenuItem key={b} value={b}>
                      {b}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  label="Unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="E.g. #12-05"
                  fullWidth
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <DescriptionOutlinedIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Stack>

              {/* Optional GPS — supplements (never replaces) block/unit. */}
              <LocationCapture value={gps} onChange={setGps} />

              {/* Photo picker / dropzone */}
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  Photos (optional)
                </Typography>
                {previewUrl ? (
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}
                  >
                    <Box
                      component="img"
                      src={previewUrl}
                      alt="Selected preview"
                      sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1.5 }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ flexGrow: 1, wordBreak: 'break-all' }}
                    >
                      {file?.name}
                    </Typography>
                    <IconButton
                      aria-label="Remove photo"
                      onClick={() => setFile(null)}
                      size="small"
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ) : (
                  <Box
                    component="label"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      py: 4,
                      px: 2,
                      textAlign: 'center',
                      border: '1px dashed',
                      borderColor: dragOver ? 'primary.main' : 'divider',
                      borderRadius: 2,
                      cursor: 'pointer',
                      color: 'text.secondary',
                      bgcolor: dragOver ? (theme) => alpha(theme.palette.primary.main, 0.04) : 'transparent',
                      transition: (theme) =>
                        theme.transitions.create(['border-color', 'background-color', 'color']),
                      '&:hover': {
                        borderColor: 'primary.main',
                        color: 'primary.main',
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
                      },
                      '&:focus-within': {
                        borderColor: 'primary.main',
                        boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}`,
                      },
                    }}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={handleFileChange}
                    />
                    <AddPhotoAlternateOutlinedIcon fontSize="large" />
                    <Typography variant="body2" fontWeight={600}>
                      Add photos
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Drag and drop or click to upload
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      JPG, PNG up to 10MB each — AI scans it for defects
                    </Typography>
                  </Box>
                )}
              </Box>

              <Stack direction="row" justifyContent="space-between" sx={{ pt: 1 }}>
                <Button variant="outlined" component={RouterLink} to="/dashboard">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={submitting}
                  startIcon={
                    submitting ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />
                  }
                  sx={{ px: 4 }}
                >
                  {submitting ? 'Submitting…' : 'Submit issue'}
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
