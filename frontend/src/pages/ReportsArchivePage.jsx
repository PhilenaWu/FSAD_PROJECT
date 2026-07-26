// UC-009 Reports Archive (manager/admin). Lists the generated monthly PDF
// reports and lets a manager trigger a fresh one for the current month. Matches
// the MUI patterns used across the app (see AdminVendorPage / DashboardPage).
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  InputAdornment,
  Paper,
  Snackbar,
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
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useAuth } from '../context/AuthContext';
import { getReports, generateManualReport } from '../services/reportService';

// "2024-10-01" → "Oct 2024". Formatted in UTC so a date-only value never slips
// to the previous month in a negative-offset timezone.
function periodLabel(periodStart) {
  return new Date(periodStart).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Timestamp → "24 Jul 2026, 14:30".
function generatedLabel(generatedAt) {
  return new Date(generatedAt).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Human label for the triggered_by discriminator.
function triggerChip(triggeredBy) {
  return triggeredBy === 'github_actions'
    ? <Chip size="small" label="Scheduled" color="info" variant="outlined" />
    : <Chip size="small" label="Manual" variant="outlined" />;
}

export default function ReportsArchivePage() {
  const { profile } = useAuth();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState(null); // { msg, severity } | null

  async function reload() {
    try {
      const res = await getReports();
      setReports(res.data);
      setError('');
    } catch {
      setError('Could not load reports. Refresh to try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setToast({ msg: 'Generating this month’s report…', severity: 'info' });
    try {
      // No range → the backend generates the current month to date.
      await generateManualReport();
      setToast({ msg: 'Report generated successfully.', severity: 'success' });
      reload();
    } catch (err) {
      setToast({
        msg: err.response?.data?.message || 'Report generation failed.',
        severity: 'error',
      });
    } finally {
      setGenerating(false);
    }
  }

  // Client-side search over the period and trigger labels (the list is small).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      `${periodLabel(r.period_start)} ${r.triggered_by}`.toLowerCase().includes(q)
    );
  }, [reports, search]);

  // Route-level protection: only managers/admins may view the archive.
  if (profile && !['manager', 'admin'].includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 4 } }}>
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={2}
          sx={{ mb: 1 }}
        >
          <Box>
            <Typography variant="h4" component="h1" fontWeight={700}>
              Reports Archive
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Monthly estate maintenance reports, generated automatically on the 1st.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <AddIcon />}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Generating…' : 'Generate Report'}
          </Button>
        </Stack>

        {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

        <TextField
          size="small"
          placeholder="Search by period or trigger"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ my: 2, width: { xs: '100%', sm: 320 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : visible.length === 0 ? (
          <Alert severity="info">
            {reports.length === 0
              ? 'No reports yet. Generate the first one with the button above.'
              : 'No reports match your search.'}
          </Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Period</TableCell>
                  <TableCell>Generated On</TableCell>
                  <TableCell>Triggered By</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{periodLabel(r.period_start)}</TableCell>
                    <TableCell>{generatedLabel(r.generated_at)}</TableCell>
                    <TableCell>{triggerChip(r.triggered_by)}</TableCell>
                    <TableCell align="right">
                      {r.report_url ? (
                        <Button
                          size="small"
                          startIcon={<FileDownloadOutlinedIcon />}
                          href={r.report_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Download PDF
                        </Button>
                      ) : (
                        <Chip size="small" color="error" label="Upload failed" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Container>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
