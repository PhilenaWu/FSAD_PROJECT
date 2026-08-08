// UC-008 / UC-010: the contractor's half of /notifications. A contractor on
// site reports upwards — access refused, an unsafe lift, a part that will not
// arrive — so the audience is the estate managers, the inspectors, or both,
// and nothing else. Two toggle cards rather than three radio cards: "both" is
// the pair selected. A resident is unreachable from here by construction —
// every combination maps to a staff-role scope, never a block — and the
// backend enforces the same list. The banner states the current audience
// before the message is written, the way the manager composer's "Send to
// recipients" banner does.
//
// Deliberately NOT the manager composer with fields hidden: that page fetches
// manager-only endpoints on mount (/notifications/sent, the contractor list),
// which 403 for this role. NotificationsPage picks between the two by role.
//
// No scheduling and no read receipts: both are manager tools for planned
// broadcasts, and neither makes sense for someone reporting a problem now.
// Received messages are in the bell, so this page only sends.
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
  Grid2 as Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SendIcon from '@mui/icons-material/Send';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SupervisorAccountOutlinedIcon from '@mui/icons-material/SupervisorAccountOutlined';
import EngineeringOutlinedIcon from '@mui/icons-material/EngineeringOutlined';
import { send } from '../services/notificationService';

// The two audiences a contractor may address, as toggles rather than three
// mutually-exclusive cards: "both" is the pair selected, not a third box.
const AUDIENCES = [
  {
    value: 'managers',
    label: 'Managers',
    description: 'Access, scheduling, cost',
    summary: 'the estate managers',
    icon: SupervisorAccountOutlinedIcon,
    color: 'info',
  },
  {
    value: 'inspectors',
    label: 'Inspectors',
    description: 'What you found on the lift',
    summary: 'the inspectors',
    icon: EngineeringOutlinedIcon,
    color: 'success',
  },
];

// Selected toggles -> the scope the API expects. Three combinations, and the
// backend allows exactly these three from a contractor; each names a staff
// role rather than a block, which is what keeps a resident unreachable here.
function scopeTypeFor(selected) {
  if (selected.length === 2) return 'managers_and_inspectors';
  return selected[0] === 'managers' ? 'managers' : 'inspector_team';
}

// "the estate managers and inspectors" — completes "Goes to …" and "It goes
// to … as a Warning message".
function summarise(selected) {
  const parts = AUDIENCES.filter((a) => selected.includes(a.value)).map((a) => a.summary);
  return parts.length === 2 ? 'the estate managers and inspectors' : parts[0];
}

// Same three levels the manager composer offers. Critical is kept: a
// contractor who finds a lift unsafe needs to say so at that weight.
const URGENCIES = [
  { value: 'Informational', label: 'Informational — for their records' },
  { value: 'Warning', label: 'Warning — needs attention' },
  { value: 'Critical', label: 'Critical — unsafe or blocking' },
];

const MAX_LENGTH = 500; // mirrors the backend's own limit

export default function ContractorNotifyPage() {
  const [message, setMessage] = useState('');
  // Both by default — the common case is "tell whoever oversees this job".
  const [audiences, setAudiences] = useState(['managers', 'inspectors']);
  const [urgency, setUrgency] = useState('Informational');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // { recipients_count }
  const [error, setError] = useState('');

  const tooLong = message.length > MAX_LENGTH;
  // An empty audience has nobody to send to, so it blocks the send rather
  // than failing at the API.
  const canSend = Boolean(message.trim()) && !tooLong && audiences.length > 0;
  const audienceSummary = summarise(audiences);

  function toggleAudience(value) {
    setAudiences((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  async function handleConfirm() {
    setConfirmOpen(false);
    setSending(true);
    setError('');
    try {
      // Only the three staff audiences are offered, and the backend refuses
      // anything else from a contractor — the UI is not the enforcement.
      const { data } = await send({
        message: message.trim(),
        scope: { type: scopeTypeFor(audiences) },
        urgency,
      });
      setSent({ recipients_count: data.recipients_count });
      // The audience is left as it was: a contractor who reports to the
      // inspectors once usually has more for the same people.
      setMessage('');
      setUrgency('Informational');
    } catch (err) {
      setError(err.response?.data?.message ?? 'Could not send — please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 4 }, px: 2 }}>
      <Container maxWidth="sm" disableGutters>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <CampaignOutlinedIcon color="primary" />
          <Typography variant="h5" fontWeight={700}>
            Message the office
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Raise something that cannot wait for the job to be submitted.
        </Typography>

        {/* Who this reaches, stated before the message is written (D.5), and
            kept in step with the picker below. */}
        <Alert severity="info" icon={<GroupsOutlinedIcon />} sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={700}>
            {audiences.length ? `Goes to ${audienceSummary}` : 'Pick who this goes to'}
          </Typography>
          <Typography variant="caption">
            Residents never see these messages. For work you have finished, submit the
            job from My jobs instead — that notifies them automatically.
          </Typography>
        </Alert>

        {sent && (
          <Alert severity="success" onClose={() => setSent(null)} sx={{ mb: 2 }}>
            Sent to {sent.recipients_count} recipient{sent.recipients_count === 1 ? '' : 's'}.
          </Alert>
        )}
        {error && (
          <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Paper
          elevation={1}
          sx={{ p: 3, borderRadius: 3 }}
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            setConfirmOpen(true);
          }}
        >
          {/* Audience cards, matching the manager composer's "Send to" block
              rather than a select. These are toggles, not radio cards: both
              selected is how you reach everyone, so there is no third box. */}
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            Send to
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Pick one or both.
          </Typography>
          <Grid container spacing={1.5} sx={{ mb: 3 }}>
            {AUDIENCES.map(({ value, label, description, icon: Icon, color }) => {
              const selected = audiences.includes(value);
              return (
                <Grid key={value} size={{ xs: 12, sm: 6 }}>
                  <Paper
                    variant="outlined"
                    onClick={() => toggleAudience(value)}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 1.5,
                      alignItems: 'flex-start',
                      height: '100%',
                      borderColor: selected ? 'primary.main' : 'divider',
                      borderWidth: selected ? 2 : 1,
                      bgcolor: selected ? (t) => alpha(t.palette.primary.main, 0.04) : 'transparent',
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        flexShrink: 0,
                        color: `${color}.main`,
                        bgcolor: (t) => alpha(t.palette[color].main, 0.12),
                      }}
                    >
                      <Icon fontSize="small" />
                    </Box>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700}>
                        {label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {description}
                      </Typography>
                    </Box>
                    {/* A tick, not just a border: these toggle independently,
                        and a border alone reads as "one of these". */}
                    <CheckCircleIcon
                      fontSize="small"
                      color={selected ? 'primary' : 'disabled'}
                      sx={{ opacity: selected ? 1 : 0.35 }}
                    />
                  </Paper>
                </Grid>
              );
            })}
          </Grid>

          <TextField
            label="Message"
            fullWidth
            multiline
            minRows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            error={tooLong}
            helperText={`${message.length} / ${MAX_LENGTH}`}
            sx={{ mb: 2 }}
          />

          <TextField
            select
            label="Urgency"
            fullWidth
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            sx={{ mb: 3 }}
          >
            {URGENCIES.map((u) => (
              <MenuItem key={u.value} value={u.value}>
                {u.label}
              </MenuItem>
            ))}
          </TextField>

          <Button
            type="submit"
            variant="contained"
            startIcon={<SendIcon />}
            disabled={!canSend || sending}
          >
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </Paper>

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <DialogTitle>Send this message?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              It goes to {audienceSummary} as a {urgency} message.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleConfirm}>
              Send
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
}
