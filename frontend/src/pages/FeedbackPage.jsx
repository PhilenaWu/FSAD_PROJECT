// Sidebar "Feedback" — general app feedback from any signed-in user.
// POSTs to /api/feedback (feedbackService) and shows a confirmation on success.
import { useState } from 'react';
import { Alert, Box, Button, Paper, Rating, Stack, TextField, Typography } from '@mui/material';
import StarOutlinedIcon from '@mui/icons-material/StarOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import { alpha } from '@mui/material/styles';
import { submitFeedback } from '../services/feedbackService';

export default function FeedbackPage() {
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { severity, text } | null

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) {
      setFeedback({ severity: 'error', text: 'Please enter a message before submitting.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await submitFeedback({ message: message.trim(), rating });
      setFeedback({ severity: 'success', text: 'Thanks — your feedback has been sent.' });
      setMessage('');
      setRating(null);
    } catch {
      setFeedback({ severity: 'error', text: 'Could not submit your feedback. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 720, mx: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: '50%',
            color: 'primary.main',
            bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
          }}
        >
          <StarOutlinedIcon />
        </Box>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Feedback
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tell us what's working and what isn't — it goes straight to the team.
          </Typography>
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack component="form" spacing={2.5} onSubmit={handleSubmit}>
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
              Overall rating (optional)
            </Typography>
            <Rating value={rating} onChange={(_, v) => setRating(v)} size="large" />
          </Box>

          <TextField
            label="Your feedback"
            placeholder="Share a suggestion, compliment, or issue with the app..."
            multiline
            minRows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            helperText={`${message.length} / 1000`}
            fullWidth
          />

          {feedback && <Alert severity={feedback.severity}>{feedback.text}</Alert>}

          <Box>
            <Button
              type="submit"
              variant="contained"
              startIcon={<SendOutlinedIcon />}
              disabled={submitting}
            >
              {submitting ? 'Sending…' : 'Send feedback'}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
