// Manager approval queue for resident self-registrations. Every row here is an
// account that can do nothing at all until it is approved, so the manager's
// job is to check the claimed block/unit against the estate records before
// letting anyone in. Reject is confirmed in a dialog because it is final.
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import EmptyState from '../components/common/EmptyState';
import { useAuth } from '../context/AuthContext';
import {
  listPendingResidents,
  approveResident,
  rejectResident,
} from '../services/userService';

function formatRequested(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PendingResidentsPage() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Id of the row whose approve/reject call is in flight.
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null); // the row awaiting confirmation

  const load = useCallback(async () => {
    try {
      const res = await listPendingResidents();
      setRequests(res.data);
    } catch {
      setError('Could not load pending registrations. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDecision(row, decision) {
    setError('');
    setSuccess('');
    setBusyId(row.id);
    try {
      if (decision === 'approve') {
        const res = await approveResident(row.id);
        // Don't claim the resident was emailed when SMTP refused it — they'd
        // be waiting on a message that never arrives.
        setSuccess(
          res.data.email_sent
            ? `${row.full_name} can now sign in, and has been emailed at ${row.email}.`
            : `${row.full_name} can now sign in, but the notification email could not be sent — let them know another way.`
        );
      } else {
        await rejectResident(row.id);
        setSuccess(`${row.full_name}'s request was rejected.`);
      }
      // Drop the row locally rather than refetching — it is no longer pending.
      setRequests((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      setError('Could not update that request. Please try again.');
    } finally {
      setBusyId(null);
      setRejecting(null);
    }
  }

  // UI-level convenience guard — the backend enforces the manager role anyway.
  if (profile && profile.role !== 'manager') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box sx={{ py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="lg">
        <Stack spacing={0.5} sx={{ mb: 3 }}>
          <Typography variant="h4" component="h1" fontWeight={700}>
            Resident requests
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Verify each person's block and unit before approving. Until you do,
            they cannot sign in or use any part of the app.
          </Typography>
        </Stack>

        <Stack spacing={2}>
          {error && (
            <Alert severity="error" onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" onClose={() => setSuccess('')}>
              {success}
            </Alert>
          )}

          {loading ? (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress />
            </Stack>
          ) : requests.length === 0 ? (
            <Paper variant="outlined" sx={{ borderRadius: 2 }}>
              <EmptyState
                icon={HowToRegOutlinedIcon}
                title="No pending requests"
                description="New resident registrations will appear here for you to verify."
              />
            </Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              {/* min-width keeps columns readable; the container scrolls
                  horizontally on narrow screens instead of crushing cells. */}
              <Table size="small" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Claimed block</TableCell>
                    <TableCell>Unit</TableCell>
                    <TableCell>Requested</TableCell>
                    <TableCell align="right">Decision</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{row.full_name}</TableCell>
                      <TableCell>{row.email}</TableCell>
                      <TableCell>
                        <Chip size="small" label={row.block_number} />
                      </TableCell>
                      <TableCell>{row.unit_number || '—'}</TableCell>
                      <TableCell>{formatRequested(row.created_at)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<CheckCircleOutlineIcon fontSize="small" />}
                          disabled={busyId === row.id}
                          onClick={() => handleDecision(row, 'approve')}
                          sx={{ mr: 1 }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<CloseIcon fontSize="small" />}
                          disabled={busyId === row.id}
                          onClick={() => setRejecting(row)}
                        >
                          Reject
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </Container>

      <Dialog open={Boolean(rejecting)} onClose={() => setRejecting(null)}>
        <DialogTitle>Reject this registration?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {rejecting?.full_name} ({rejecting?.email}) will not be able to sign
            in, and will be told their request was not approved. Their account
            stays on record, so this cannot be undone from this screen.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busyId === rejecting?.id}
            onClick={() => handleDecision(rejecting, 'reject')}
          >
            Reject request
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
