// UC-008: notification composer. /notifications serves two roles, so the
// default export below picks by role — a contractor gets ContractorNotifyPage,
// everyone else the manager composer in this file.
//
// The split is a component boundary, not an early return, because the manager
// composer's hooks fetch manager-only endpoints (/notifications/sent, the
// contractor list). A contractor rendering this component ran those anyway and
// got a 403 painted as "Could not load your notification history."
//
// Manager composer: pick a target scope, write a message, set urgency,
// optionally schedule, confirm, and send. After an immediate send the
// read-receipt badge polls live counts.
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid2 as Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SendIcon from '@mui/icons-material/Send';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import LocationCityOutlinedIcon from '@mui/icons-material/LocationCityOutlined';
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import ReadReceiptBadge from '../components/notifications/ReadReceiptBadge';
import { send, listSent } from '../services/notificationService';
import { listContractors } from '../services/contractorService';
import { useAuth } from '../context/AuthContext';
import ContractorNotifyPage from './ContractorNotifyPage';

// Card options for "Send to". `all_blocks` isn't in the reference mockup
// (which only showed 3 cards) but is real, already-working scope this page
// supported before the redesign — dropping it would remove functionality, so
// it stays as a 4th card instead.
const SCOPE_TYPES = [
  {
    value: 'blocks',
    label: 'Specific block(s)',
    description: 'Notify residents in one or more blocks',
    icon: ApartmentOutlinedIcon,
    color: 'primary',
  },
  {
    value: 'all_blocks',
    label: 'All blocks',
    description: 'Notify residents in every block',
    icon: LocationCityOutlinedIcon,
    color: 'info',
  },
  {
    value: 'contractor',
    label: 'Specific contractor',
    description: 'Notify a contractor directly',
    icon: WorkOutlineOutlinedIcon,
    color: 'secondary',
  },
  {
    value: 'inspector_team',
    label: 'Inspector team',
    description: 'Notify all inspectors on the team',
    icon: GroupsOutlinedIcon,
    color: 'success',
  },
];

const URGENCIES = [
  { value: 'Informational', icon: InfoOutlinedIcon, color: 'info' },
  { value: 'Warning', icon: WarningAmberOutlinedIcon, color: 'warning' },
  { value: 'Critical', icon: ErrorOutlineOutlinedIcon, color: 'error' },
];

// Human-readable summary of the chosen scope for the confirm dialog.
// `contractorName` falls back to the id so the dialog is still meaningful if the
// picker list failed to load.
function describeScope(scopeType, blocks, contractorId, contractorName) {
  switch (scopeType) {
    case 'blocks':
      return `residents in block(s) ${blocks || '—'}`;
    case 'all_blocks':
      return 'all residents in all blocks';
    case 'contractor':
      return `contractor ${contractorName || contractorId || '—'}`;
    case 'inspector_team':
      return 'the inspector team';
    default:
      return '';
  }
}

// Status chip colour for a row in the history (D.6).
const STATUS_COLOR = {
  Sent: 'success',
  Scheduled: 'info',
  Failed: 'error',
  Cancelled: 'default',
};

function formatWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Re-describe a stored scope for the history list. The composer builds its
// summary from form state; a history row only has the persisted JSONB back.
function describeStoredScope(scope) {
  if (!scope) return 'Unknown recipients';
  switch (scope.type) {
    case 'blocks':
      return `Block(s) ${(scope.blocks ?? []).join(', ') || '—'}`;
    case 'all_blocks':
      return 'All blocks';
    case 'contractor':
      return 'One contractor';
    case 'inspector_team':
      return 'Inspector team';
    default:
      return scope.type ?? 'Unknown recipients';
  }
}

function ManagerComposer() {
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

  // Contractor picker options. The scope needs a `users.id`, not a contractor id,
  // so only vendors with a linked login are offered — messaging one without an
  // account would resolve to no recipient. Previously this was a free-text field
  // and the manager had to paste a UUID.
  const [contractors, setContractors] = useState([]);
  const [contractorsError, setContractorsError] = useState(false);
  useEffect(() => {
    let active = true;
    listContractors()
      .then(({ data }) => {
        if (!active) return;
        setContractors((data ?? []).filter((c) => c.user_id));
      })
      .catch(() => {
        if (active) setContractorsError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Send history (D.6). Reloaded after each successful send so a new row shows
  // without a refresh. Before this the manager could only ever see receipts for
  // the notification still held in page state — navigating away lost the lot.
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(false);
  const loadHistory = useCallback(() => {
    listSent()
      .then(({ data }) => {
        setHistory(data.data ?? []);
        setHistoryError(false);
      })
      .catch(() => setHistoryError(true));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const scheduled = Boolean(sendTime);
  const selectedUrgency = URGENCIES.find((u) => u.value === urgency);

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
      return 'Select a contractor.';
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

  function handleClear() {
    setScopeType('blocks');
    setBlocks('');
    setContractorId('');
    setMessage('');
    setUrgency('Informational');
    setSendTime('');
    setError('');
    setResult(null);
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
      loadHistory();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the notification — please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 900, mx: 'auto' }}>
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
          <CampaignOutlinedIcon />
        </Box>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Send a notification
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Notify residents, a contractor, or the inspector team. Scheduled notifications are
            sent within about a minute of the selected time.
          </Typography>
        </Box>
      </Stack>

      {/* "Send to recipients" banner (D.5). The audience was only ever spelled
          out in the confirm dialog, i.e. after the manager had already composed
          and committed to the message. Restating it above the form keeps who is
          about to be messaged in view the whole time it is being written. */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 3,
          borderColor: 'primary.main',
          bgcolor: (t) => alpha(t.palette.primary.main, 0.06),
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CampaignOutlinedIcon color="primary" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700}>
              Send to recipients
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This message will go to{' '}
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                {describeScope(
                  scopeType,
                  blocks,
                  contractorId,
                  contractors.find((c) => c.user_id === contractorId)?.name
                )}
              </Box>
              {scheduled ? ' at the scheduled time.' : ', immediately.'}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
              Send to
            </Typography>
            <Grid container spacing={1.5}>
              {SCOPE_TYPES.map(({ value, label, description, icon: Icon, color }) => {
                const selected = scopeType === value;
                return (
                  <Grid key={value} size={{ xs: 12, sm: 6 }}>
                    <Paper
                      variant="outlined"
                      onClick={() => setScopeType(value)}
                      sx={{
                        p: 2,
                        borderRadius: 2,
                        cursor: 'pointer',
                        display: 'flex',
                        gap: 1.5,
                        alignItems: 'flex-start',
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
                      <Box>
                        <Typography variant="body2" fontWeight={700}>
                          {label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {description}
                        </Typography>
                      </Box>
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>
          </Box>

          {scopeType === 'blocks' && (
            <TextField
              label="Block number(s)"
              placeholder="e.g. 44A, 44B, 90C"
              value={blocks}
              onChange={(e) => setBlocks(e.target.value)}
              helperText="Comma-separated for multiple blocks."
              fullWidth
            />
          )}

          {scopeType === 'contractor' && (
            <TextField
              select
              label="Contractor"
              value={contractorId}
              onChange={(e) => setContractorId(e.target.value)}
              disabled={contractors.length === 0}
              helperText={
                contractorsError
                  ? 'Could not load contractors — reload to try again.'
                  : contractors.length === 0
                    ? 'No contractor has a linked login account yet.'
                    : 'Only contractors with a login account can be messaged.'
              }
              error={contractorsError}
              fullWidth
            >
              {contractors.map((c) => (
                <MenuItem key={c.user_id} value={c.user_id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            label="Message"
            placeholder="Type your message here..."
            multiline
            minRows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
            helperText={`${message.length} / 500 characters`}
            fullWidth
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Urgency"
              value={urgency}
              onChange={(e) => setUrgency(e.target.value)}
              helperText="Choose the urgency level of this notification."
              fullWidth
              slotProps={{
                input: {
                  startAdornment: selectedUrgency && (
                    <InputAdornment position="start">
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          color: 'common.white',
                          bgcolor: `${selectedUrgency.color}.main`,
                        }}
                      >
                        <selectedUrgency.icon sx={{ fontSize: 14 }} />
                      </Box>
                    </InputAdornment>
                  ),
                },
              }}
            >
              {URGENCIES.map((u) => (
                <MenuItem key={u.value} value={u.value}>
                  {u.value}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              type="datetime-local"
              label="Schedule (optional)"
              value={sendTime}
              onChange={(e) => setSendTime(e.target.value)}
              helperText="Leave blank to send immediately."
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" justifyContent="space-between">
            <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={handleClear}>
              Clear
            </Button>
            <Button
              variant="contained"
              startIcon={<SendIcon />}
              onClick={handleSendClick}
              disabled={sending}
            >
              {scheduled ? 'Schedule notification' : 'Send notification'}
            </Button>
          </Stack>
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

      {/* Notification history (D.6) — everything this manager has sent or
          scheduled, with read receipts already counted server-side. */}
      <Box sx={{ mt: 4 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <HistoryOutlinedIcon color="action" />
          <Typography variant="h6" fontWeight={700}>
            Notification history
          </Typography>
        </Stack>

        {historyError ? (
          <Alert severity="error">Could not load your notification history.</Alert>
        ) : history.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Nothing sent yet — notifications you send will be listed here.
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={1.5}>
            {history.map((n) => (
              <Paper key={n.id} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mb: 1 }}
                >
                  <Chip size="small" label={n.status} color={STATUS_COLOR[n.status] ?? 'default'} />
                  <Chip size="small" variant="outlined" label={n.urgency} />
                  <Chip size="small" variant="outlined" label={describeStoredScope(n.scope)} />
                  <Box sx={{ flexGrow: 1 }} />
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {n.status === 'Scheduled' ? (
                      <>
                        <ScheduleOutlinedIcon fontSize="small" color="action" />
                        <Typography variant="caption" color="text.secondary">
                          for {formatWhen(n.send_time)}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {formatWhen(n.sent_at ?? n.created_at)}
                      </Typography>
                    )}
                  </Stack>
                </Stack>

                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {n.message}
                </Typography>

                {/* A scheduled row has no recipients yet — they are resolved at
                    dispatch — so a "0 of 0 read" line there would be misleading. */}
                {n.status !== 'Scheduled' && (
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1 }}>
                    <MarkEmailReadOutlinedIcon fontSize="small" color="action" />
                    <Typography variant="caption" color="text.secondary">
                      {n.read_count} of {n.total_recipients} recipient
                      {n.total_recipients === 1 ? '' : 's'} read
                    </Typography>
                  </Stack>
                )}
              </Paper>
            ))}
          </Stack>
        )}
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{scheduled ? 'Schedule notification?' : 'Send notification?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {scheduled ? 'Schedule this message for ' : 'Send this message to '}
            {describeScope(
              scopeType,
              blocks,
              contractorId,
              contractors.find((c) => c.user_id === contractorId)?.name
            )}
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
    </Box>
  );
}

// /notifications for whoever is signed in. Only the contractor composer is
// split out; the manager composer is also what an admin or inspector reaching
// this route gets, unchanged from before.
export default function NotificationsPage() {
  const { profile } = useAuth();
  return profile?.role === 'contractor' ? <ContractorNotifyPage /> : <ManagerComposer />;
}
