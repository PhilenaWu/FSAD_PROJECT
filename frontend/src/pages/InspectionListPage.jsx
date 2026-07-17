// UC-002 manager triage queue. All inspections from GET /api/inspections,
// most urgent first (AI priority score), with status/category/block filters.
// Row click opens the detail/triage view. Manager-only (backend enforces too).
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

// Schema enums (migration 004) for the filter dropdowns.
const STATUSES = [
  'Open', 'Pending Assignment', 'Assigned', 'Acknowledged',
  'On Hold', 'Rectified', 'Resolved', 'Closed',
];
const CATEGORIES = [
  'Structural', 'Electrical', 'Plumbing', 'Cleanliness', 'Lift', 'Doors',
  'Cabin', 'Safety', 'Landscaping', 'Pest', 'Other', 'Uncategorised',
];

const PRIORITY_COLOR = { Critical: 'error', High: 'warning', Medium: 'default', Low: 'default' };

export default function InspectionListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [block, setBlock] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = {};
    if (status) params.status = status;
    if (category) params.category = category;
    if (block) params.block = block;
    api
      .get('/api/inspections', { params })
      .then((res) => {
        if (active) {
          setRows(res.data.data);
          setLoadError(false);
        }
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
  }, [status, category, block]);

  // Block filter options come from the data itself (no blocks endpoint yet).
  const blockOptions = useMemo(
    () => [...new Set(rows.map((r) => r.location_block))].sort(),
    [rows]
  );

  // UI-level guard — backend requireRole('manager') is the real enforcement.
  if (profile && profile.role !== 'manager') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 4 }, px: 2 }}>
      <Container maxWidth="lg" disableGutters>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h5" component="h1" fontWeight={700}>
              Triage queue
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Most urgent first — sorted by AI priority score
            </Typography>
          </Box>

          {/* Filters */}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField
              select size="small" label="Status" value={status}
              onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All</MenuItem>
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
            <TextField
              select size="small" label="Category" value={category}
              onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All</MenuItem>
              {CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
            <TextField
              select size="small" label="Block" value={block}
              onChange={(e) => setBlock(e.target.value)} sx={{ minWidth: 110 }}
            >
              <MenuItem value="">All</MenuItem>
              {blockOptions.map((b) => (
                <MenuItem key={b} value={b}>{b}</MenuItem>
              ))}
            </TextField>
          </Stack>
        </Stack>

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : loadError ? (
          <Alert severity="error">Could not load the queue. Refresh to try again.</Alert>
        ) : rows.length === 0 ? (
          <Paper elevation={1} sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              No inspections match the current filters.
            </Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper} elevation={1} sx={{ borderRadius: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Block</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell align="right">Score</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => navigate(`/inspections/${r.id}`)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {r.title}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.location_block}</TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={PRIORITY_COLOR[r.priority] ?? 'default'}
                        variant={r.priority === 'Low' ? 'outlined' : 'filled'}
                        label={r.priority}
                      />
                    </TableCell>
                    <TableCell align="right">{r.ai_priority_score ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Container>
    </Box>
  );
}
