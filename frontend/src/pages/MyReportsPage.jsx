// UC-003 "My reports" page — REST layer (task 3.11). Lists the signed-in
// originator's reports from GET /api/inspections/my as status cards, with a
// rating UI skeleton on resolved/closed reports (submit endpoint lands later).
// Zoe wires the Socket.IO live-update layer separately (Z.3) — no sockets here.
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  Link,
  Paper,
  Rating,
  Stack,
  Typography,
} from '@mui/material';
import api from '../services/api';
import { statusDisplay } from '../utils/statusDisplay';

// Ratable once the work is done; rating submission is a later task.
const RATABLE_STATUSES = ['Resolved', 'Closed'];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function MyReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get('/api/inspections/my')
      .then((res) => {
        if (active) setReports(res.data.data);
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

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 720 }}>
        <Typography
          variant="h4"
          component="h1"
          fontWeight={700}
          sx={{ mb: 3, color: 'primary.main', textAlign: 'center' }}
        >
          My reports
        </Typography>

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : loadError ? (
          <Alert severity="error">
            Could not load your reports. Refresh to try again.
          </Alert>
        ) : reports.length === 0 ? (
          <Paper elevation={2} sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
              No reports yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Spotted an issue in your estate?{' '}
              <Link component={RouterLink} to="/report" underline="hover">
                Report it here
              </Link>
              .
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {reports.map((r) => {
              const display = statusDisplay(r.status);
              const ratable = RATABLE_STATUSES.includes(r.status);
              return (
                <Paper key={r.id} elevation={2} sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 3 }}>
                  <Stack direction="row" spacing={2}>
                    {r.photo_url && (
                      <Box
                        component="img"
                        src={r.photo_url}
                        alt=""
                        sx={{
                          width: 72,
                          height: 72,
                          objectFit: 'cover',
                          borderRadius: 2,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="flex-start"
                        spacing={1}
                      >
                        <Typography variant="subtitle1" fontWeight={700} sx={{ minWidth: 0 }}>
                          {r.title}
                        </Typography>
                        <Chip size="small" color={display.color} label={display.label} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {r.category} · Block {r.location_block}
                        {r.location_unit ? ` #${r.location_unit}` : ''} ·{' '}
                        {formatDate(r.created_at)}
                      </Typography>

                      {/* Rating skeleton — submission wiring is a later task. */}
                      {ratable && (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                          <Rating
                            size="small"
                            value={r.satisfaction_rating ?? null}
                            readOnly={Boolean(r.satisfaction_rating)}
                            disabled={!r.satisfaction_rating}
                          />
                          <Typography variant="caption" color="text.secondary">
                            {r.satisfaction_rating
                              ? 'Your rating'
                              : 'Rate the resolution (coming soon)'}
                          </Typography>
                        </Stack>
                      )}
                    </Box>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Container>
    </Box>
  );
}
