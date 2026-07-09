// UC-001 "Report an issue" page. Residents file a complaint (optional photo)
// via POST /api/inspections. Category/priority are set by the backend AI.
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CloseIcon from '@mui/icons-material/Close';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import api from '../services/api';

// Placeholder block list until a real blocks source exists.
const BLOCKS = ['44A', '44B', '44C', '45A', '45B'];

export default function ReportIssuePage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [block, setBlock] = useState('');
  const [unit, setUnit] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { severity, message }

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
  }

  function handleFileChange(e) {
    const chosen = e.target.files?.[0];
    if (chosen) setFile(chosen);
    // Allow re-selecting the same file later.
    e.target.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
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
    if (file) formData.append('photo', file);

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
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 720 }}>
        <Typography variant="h4" component="h1" fontWeight={700} sx={{ mb: 3, color: 'primary.main' }}>
          Report an issue
        </Typography>

        <Paper elevation={2} sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={3}>
              {feedback && (
                <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>
                  {feedback.message}
                </Alert>
              )}

              <TextField
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                fullWidth
              />

              <TextField
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                fullWidth
                multiline
                minRows={4}
                helperText="Describe the issue and exactly where it is, e.g. Level 3 lift lobby"
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Block"
                  value={block}
                  onChange={(e) => setBlock(e.target.value)}
                  required
                  fullWidth
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
                  placeholder="#12-05"
                  fullWidth
                />
              </Stack>

              {/* Photo picker / dropzone */}
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Photo
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
                      borderColor: 'divider',
                      borderRadius: 2,
                      cursor: 'pointer',
                      color: 'text.secondary',
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
                    <Typography variant="body2">
                      Add a photo — AI scans it for defects
                    </Typography>
                  </Box>
                )}
              </Box>

              {/* AI note */}
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{
                  px: 2,
                  py: 1.5,
                  borderRadius: 2,
                  color: 'primary.main',
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
                }}
              >
                <AutoAwesomeOutlinedIcon fontSize="small" />
                <Typography variant="body2">
                  Category and priority are set automatically by AI
                </Typography>
              </Stack>

              <Button
                type="submit"
                variant="contained"
                color="primary"
                size="large"
                disabled={submitting}
                startIcon={
                  submitting ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />
                }
                sx={{ alignSelf: 'flex-start', px: 4 }}
              >
                {submitting ? 'Submitting…' : 'Submit report'}
              </Button>

              <Typography variant="caption" color="text.secondary">
                Title and block are required. Duplicate reports within 2 minutes are blocked.
              </Typography>
            </Stack>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
