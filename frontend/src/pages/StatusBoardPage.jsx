// Resident status board — privacy-safe estate-wide view of complaints from
// GET /api/inspections/status-board. Shows only block / category / status /
// relative time; the backend's allow-list guarantees no identifying fields.
// Reports are grouped traffic-light style (red = under review, yellow = in
// progress, green = completed) with a dropdown filter and summary counts.
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import api from '../services/api';
import { STATUS_GROUPS, statusDisplay, statusGroup } from '../utils/statusDisplay';

// "2 days ago" style relative time — small local helper, no date library.
const TIME_UNITS = [
  [60, 'minute'], // after 60s
  [3600, 'hour'],
  [86400, 'day'],
  [604800, 'week'],
  [2629800, 'month'],
  [31557600, 'year'],
];

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  if (seconds < 60) return 'just now';
  let label = 'minute';
  let value = Math.floor(seconds / 60);
  for (const [size, unit] of TIME_UNITS) {
    if (seconds < size) break;
    label = unit;
    value = Math.floor(seconds / size);
  }
  return `${value} ${label}${value === 1 ? '' : 's'} ago`;
}

export default function StatusBoardPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | group key

  useEffect(() => {
    let active = true;
    api
      .get('/api/inspections/status-board')
      .then((res) => {
        if (active) setRows(res.data.data);
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

  // Count per group (for the summary chips) and the filtered list.
  const counts = useMemo(() => {
    const c = { review: 0, progress: 0, done: 0 };
    for (const r of rows) c[statusGroup(r.status)] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => statusGroup(r.status) === filter)),
    [rows, filter]
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 720 }}>
        <Typography
          variant="h4"
          component="h1"
          fontWeight={700}
          sx={{ mb: 1, color: 'primary.main', textAlign: 'center' }}
        >
          Estate status board
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 3, textAlign: 'center' }}
        >
          Reported issues across the estate — no personal details shown
        </Typography>

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : loadError ? (
          <Alert severity="error">
            Could not load the status board. Refresh to try again.
          </Alert>
        ) : (
          <Stack spacing={2}>
            {/* Summary counts + progress filter. Chips double as filters. */}
            <Paper elevation={1} sx={{ p: 2, borderRadius: 3 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {Object.entries(STATUS_GROUPS).map(([key, group]) => (
                    <Chip
                      key={key}
                      size="small"
                      variant={filter === key ? 'filled' : 'outlined'}
                      color={group.color}
                      label={`${group.label} · ${counts[key]}`}
                      onClick={() => setFilter(filter === key ? 'all' : key)}
                    />
                  ))}
                </Stack>
                <TextField
                  select
                  size="small"
                  label="Show"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  sx={{ minWidth: 170 }}
                >
                  <MenuItem value="all">All reports ({rows.length})</MenuItem>
                  {Object.entries(STATUS_GROUPS).map(([key, group]) => (
                    <MenuItem key={key} value={key}>
                      {group.label} ({counts[key]})
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Paper>

            {rows.length === 0 ? (
              <Paper elevation={2} sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                  Nothing reported yet
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  When residents report issues, their progress shows up here.
                </Typography>
              </Paper>
            ) : visible.length === 0 ? (
              <Paper elevation={1} sx={{ p: 3, borderRadius: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No reports in “{STATUS_GROUPS[filter].label}” right now.
                </Typography>
              </Paper>
            ) : (
              visible.map((r) => {
                const display = statusDisplay(r.status);
                const group = STATUS_GROUPS[statusGroup(r.status)];
                return (
                  <Paper
                    key={r.id}
                    elevation={1}
                    sx={{
                      p: { xs: 2, sm: 2.5 },
                      borderRadius: 3,
                      // Traffic-light accent: red / yellow / green edge.
                      borderLeft: 4,
                      borderLeftColor: `${group.color}.main`,
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      spacing={2}
                    >
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                        {/* Status dot matching the group colour. */}
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            bgcolor: `${group.color}.main`,
                            flexShrink: 0,
                          }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2" fontWeight={700}>
                            Block {r.location_block}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {r.category} · {timeAgo(r.created_at)}
                          </Typography>
                        </Box>
                      </Stack>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={group.color}
                        label={display.label}
                      />
                    </Stack>
                  </Paper>
                );
              })
            )}
          </Stack>
        )}
      </Container>
    </Box>
  );
}
