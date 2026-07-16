// UC-008: manager notification composer. Pick a target scope, write a message,
// set urgency, optionally schedule, confirm, and send. After an immediate send
// the read-receipt badge polls live counts.
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import ReadReceiptBadge from '../components/notifications/ReadReceiptBadge';
import { send } from '../services/notificationService';

const SCOPE_TYPES = [
  { value: 'blocks', label: 'Specific block(s)' },
  { value: 'all_blocks', label: 'All blocks (all residents)' },
  { value: 'contractor', label: 'A contractor' },
  { value: 'inspector_team', label: 'Inspector team' },
];

const URGENCIES = ['Informational', 'Warning', 'Critical'];

// Human-readable summary of the chosen scope for the confirm dialog.
function describeScope(scopeType, blocks, contractorId) {
  switch (scopeType) {
    case 'blocks':
      return `residents in block(s) ${blocks || '—'}`;
    case 'all_blocks':
      return 'all residents in all blocks';
    case 'contractor':
      return `contractor ${contractorId || '—'}`;
    case 'inspector_team':
      return 'the inspector team';
    default:
      return '';
  }
}

export default function NotificationsPage() {
  const [scopeType, setScopeType] = useState('blocks');
  const [blocks, setBlocks] = useState(''); // comma-separated, e.g. "44A, 44B"
  const [contractorId, setContractorId] = useState('');
  const [message, setMessage] = useState('');
  const [urgency, setUrgency] = useState('Informational');
  const [sendTime, setSendTime] = useState(''); // datetime-local; blank = now
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { notification_id, status, recipients_count? }
  const [error, setError] = useState('');

  const scheduled = Boolean(sendTime);

  // Build the scope object the API expects from the form state.
  function buildScope() {
    if (scopeType === 'blocks') {
      return {
        type: 'blocks',
        blocks: blocks
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean),
      };
    }
    if (scopeType === 'contractor') {
      return { type: 'contractor', contractor_user_id: contractorId.trim() };
    }
    return { type: scopeType };
  }

  // Client-side guard mirroring the backend rules, so the confirm dialog only
  // opens on a valid form.
  function validate() {
    if (!message.trim() || message.length > 500) {
      return 'Message is required and must be 500 characters or fewer.';
    }
    if (scopeType === 'blocks' && !blocks.trim()) {
      return 'Enter at least one block number.';
    }
    if (scopeType === 'contractor' && !contractorId.trim()) {
      return "Enter the contractor's user id.";
    }
    return '';
  }

  function handleSendClick() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError('');
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    setSending(true);
    setError('');
    setResult(null);
    try {
      const { data } = await send({
        message: message.trim(),
        scope: buildScope(),
        urgency,
        send_time: sendTime ? new Date(sendTime).toISOString() : null,
      });
      setResult(data);
      setMessage('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the notification — please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Send a notification
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Notify residents, a contractor, or the inspector team. Scheduled
        notifications are sent within about a minute of the selected time.
      </Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2.5}>
          <TextField
            select
            label="Send to"
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value)}
          >
            {SCOPE_TYPES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>

          {scopeType === 'blocks' && (
            <TextField
              label="Block number(s)"
              placeholder="e.g. 44A, 44B"
              value={blocks}
              onChange={(e) => setBlocks(e.target.value)}
              helperText="Comma-separated for multiple blocks."
            />
          )}

          {scopeType === 'contractor' && (
            <TextField
              label="Contractor user id"
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
            />
          )}

          <TextField
            label="Message"
            multiline
            minRows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            inputProps={{ maxLength: 500 }}
            helperText={`${message.length}/500`}
          />

          <TextField
            select
            label="Urgency"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
          >
            {URGENCIES.map((u) => (
              <MenuItem key={u} value={u}>
                {u}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            type="datetime-local"
            label="Schedule (optional)"
            value={sendTime}
            onChange={(e) => setSendTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Leave blank to send immediately."
          />

          {error && <Alert severity="error">{error}</Alert>}

          <Button
            variant="contained"
            startIcon={<SendIcon />}
            onClick={handleSendClick}
            disabled={sending}
          >
            {scheduled ? 'Schedule' : 'Send'}
          </Button>
        </Stack>
      </Paper>

      {/* Result: scheduled confirmation, or live receipts for an immediate send. */}
      {result?.status === 'Scheduled' && (
        <Alert severity="success" sx={{ mt: 3 }}>
          Scheduled — it will be sent within about a minute of the selected time.
        </Alert>
      )}
      {result?.status === 'Sent' && (
        <Box sx={{ mt: 3 }}>
          <Alert severity="success" sx={{ mb: 2 }}>
            Sent to {result.recipients_count} recipient
            {result.recipients_count === 1 ? '' : 's'}.
          </Alert>
          <ReadReceiptBadge notificationId={result.notification_id} />
        </Box>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{scheduled ? 'Schedule notification?' : 'Send notification?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {scheduled ? 'Schedule this message for ' : 'Send this message to '}
            {describeScope(scopeType, blocks, contractorId)}
            {scheduled ? '.' : ' now?'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirm}>
            {scheduled ? 'Schedule' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
