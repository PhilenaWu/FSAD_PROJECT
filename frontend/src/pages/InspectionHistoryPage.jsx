// Closed-record history (UC-002 / UC-015). Closing archives a record
// (is_deleted = TRUE) and drops it from the triage queue, which is right for
// day-to-day work but left completed jobs with nowhere to be seen. This page is
// that place: GET /api/inspections?archived=true, newest closure first, with
// the same category/block filters as the live queue. Deliberately a separate
// route rather than a queue tab — the client asked for completed work to stay
// out of the way unless it's specifically asked for.
// Row click opens the read-only detail view.
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  InputAdornment,
  Link,
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { getFilterOptions } from '../services/analyticsService';
import { CATEGORIES } from '../utils/inspectionOptions';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatCost(value) {
  if (value === null || value === undefined) return '—';
  return `$${Number(value).toFixed(2)}`;
}

export default function InspectionHistoryPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Same URL-driven filter pattern as the live queue, so a filtered history
  // view is bookmarkable and shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('category') ?? '';
  const block = searchParams.get('block') ?? '';
  const [search, setSearch] = useState('');

  const setFilter = (key) => (e) => {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) {
      next.set(key, e.target.value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { archived: 'true' };
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
  }, [category, block]);

  const [blockOptions, setBlockOptions] = useState([]);
  useEffect(() => {
    getFilterOptions()
      .then((o) => setBlockOptions(o.blocks ?? []))
      .catch(() => {}); // dropdown just stays empty; "All" still works
  }, []);

  // Title search is client-side — the archive is filtered server-side by
  // category/block first, so what's left is small enough to scan in memory.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.title} ${r.location_block}`.toLowerCase().includes(q));
  }, [rows, search]);

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

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h5" component="h1" fontWeight={700}>
              Closed records
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Completed and archived work, most recently closed first
            </Typography>
          </Box>

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              placeholder="Search title or block"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ minWidth: 200 }}
            />
            <TextField
              select size="small" label="Category" value={category}
              onChange={setFilter('category')} sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All</MenuItem>
              {CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
            <TextField
              select size="small" label="Block" value={block}
              onChange={setFilter('block')} sx={{ minWidth: 110 }}
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
          <Alert severity="error">Could not load the history. Refresh to try again.</Alert>
        ) : visible.length === 0 ? (
          <Paper elevation={1} sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              No closed records match the current filters.
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
                  <TableCell>Closed</TableCell>
                  <TableCell align="right">Resolution (h)</TableCell>
                  <TableCell align="right">Cost</TableCell>
                  <TableCell align="right">Re-opened</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((r) => (
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
                    <TableCell>{formatDate(r.closed_at)}</TableCell>
                    <TableCell align="right">
                      {r.resolution_time_hours === null || r.resolution_time_hours === undefined
                        ? '—'
                        : Number(r.resolution_time_hours).toFixed(1)}
                    </TableCell>
                    <TableCell align="right">{formatCost(r.actual_cost)}</TableCell>
                    <TableCell align="right">
                      {r.reopen_count > 0 ? (
                        <Chip size="small" color="warning" label={`×${r.reopen_count}`} />
                      ) : (
                        '—'
                      )}
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
