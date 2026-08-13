// Resident status board — privacy-safe estate-wide view of complaints from
// GET /api/inspections/status-board. The backend allow-list guarantees no
// identifying fields (title/description/resident/unit/photo are never sent —
// see inspectionModel.findForStatusBoard) — only block, category, status and
// timestamps. That means the "Issue" column here shows a category-based
// label ("Lift issue"), not the resident's own free-text title, unlike some
// designs might expect; showing the real title/description on a
// privacy-scoped estate-wide board would defeat the point of that guard.
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  Grid2 as Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import SearchIcon from '@mui/icons-material/Search';
import FilterAltOffOutlinedIcon from '@mui/icons-material/FilterAltOffOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import api from '../services/api';
import { STATUS_GROUPS, statusDisplay, statusGroup } from '../utils/statusDisplay';
import { categoryDisplay } from '../utils/categoryDisplay';
import { timeAgo } from '../utils/timeAgo';
import Sparkline from '../components/common/Sparkline';
import EmptyState from '../components/common/EmptyState';

const PAGE_SIZES = [10, 25, 50];

// Report counts per day for the last `days` days, split by status group —
// backs the KPI tile sparklines. Bucketed client-side from real created_at
// timestamps already in `rows`; not a separate endpoint.
function buildDailyTrend(rows, days = 14) {
  const MS_DAY = 86400000;
  const end = new Date();
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayEnd = new Date(end.getTime() - i * MS_DAY);
    dayEnd.setHours(23, 59, 59, 999);
    const dayStart = new Date(dayEnd);
    dayStart.setHours(0, 0, 0, 0);
    buckets.push({ start: dayStart, end: dayEnd, review: 0, progress: 0, done: 0, total: 0 });
  }
  for (const r of rows) {
    const created = new Date(r.created_at);
    const bucket = buckets.find((b) => created >= b.start && created <= b.end);
    if (!bucket) continue;
    bucket.total += 1;
    bucket[statusGroup(r.status)] += 1;
  }
  return buckets;
}

function KpiCard({ label, value, sub, color, sparkline }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Typography variant="overline" fontWeight={700} sx={{ color: `${color}.main`, letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: '50%',
            color: `${color}.main`,
            bgcolor: (t) => alpha(t.palette[color].main, 0.12),
          }}
        >
          <GridViewOutlinedIcon sx={{ fontSize: 16 }} />
        </Box>
      </Stack>
      <Typography variant="h4" fontWeight={700} sx={{ color: `${color}.main` }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {sub}
      </Typography>
      <Sparkline data={sparkline} color={color} />
    </Paper>
  );
}

export default function StatusBoardPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [tab, setTab] = useState('all'); // 'all' | group key
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [blockFilter, setBlockFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const counts = useMemo(() => {
    const c = { review: 0, progress: 0, done: 0 };
    for (const r of rows) c[statusGroup(r.status)] += 1;
    return c;
  }, [rows]);

  const trend = useMemo(() => buildDailyTrend(rows), [rows]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows]
  );
  const blocks = useMemo(
    () => [...new Set(rows.map((r) => r.location_block))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && statusGroup(r.status) !== tab) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (blockFilter !== 'all' && r.location_block !== blockFilter) return false;
      if (!q) return true;
      return (
        r.location_block?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q) ||
        statusDisplay(r.status).label.toLowerCase().includes(q)
      );
    });
  }, [rows, tab, categoryFilter, blockFilter, search]);

  // Any filter change invalidates the current page.
  useEffect(() => {
    setPage(1);
  }, [tab, categoryFilter, blockFilter, search, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const isFiltering = tab !== 'all' || categoryFilter !== 'all' || blockFilter !== 'all' || Boolean(search);

  function resetFilters() {
    setTab('all');
    setCategoryFilter('all');
    setBlockFilter('all');
    setSearch('');
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: '50%',
            color: 'secondary.main',
            bgcolor: (t) => alpha(t.palette.secondary.main, 0.12),
          }}
        >
          <GridViewOutlinedIcon />
        </Box>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>
            Estate status board
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Reported issues across the estate — no personal details shown.
          </Typography>
        </Box>
      </Stack>

      {loading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : loadError ? (
        <Alert severity="error">Could not load the status board. Refresh to try again.</Alert>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <EmptyState
            icon={GridViewOutlinedIcon}
            title="Nothing reported yet"
            description="When residents report issues, their progress shows up here."
          />
        </Paper>
      ) : (
        <>
          {/* KPI row + filter panel */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <KpiCard
                label="Under review"
                value={counts.review}
                sub={`${Math.round((counts.review / rows.length) * 100)}% of all reports`}
                color="error"
                sparkline={trend.map((b) => b.review)}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <KpiCard
                label="In progress"
                value={counts.progress}
                sub={`${Math.round((counts.progress / rows.length) * 100)}% of all reports`}
                color="warning"
                sparkline={trend.map((b) => b.progress)}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <KpiCard
                label="Completed"
                value={counts.done}
                sub={`${Math.round((counts.done / rows.length) * 100)}% of all reports`}
                color="success"
                sparkline={trend.map((b) => b.done)}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <KpiCard
                label="Total reports"
                value={rows.length}
                sub="100% of all reports"
                color="secondary"
                sparkline={trend.map((b) => b.total)}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 2.4 }}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
                <Stack spacing={1.5}>
                  <FormControl size="small" fullWidth>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                      Show
                    </Typography>
                    <Select value={tab} onChange={(e) => setTab(e.target.value)}>
                      <MenuItem value="all">All reports ({rows.length})</MenuItem>
                      {Object.entries(STATUS_GROUPS).map(([key, group]) => (
                        <MenuItem key={key} value={key}>
                          {group.label} ({counts[key]})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                      Filter by
                    </Typography>
                    <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                      <MenuItem value="all">All categories</MenuItem>
                      {categories.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <Select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)}>
                      <MenuItem value="all">All blocks</MenuItem>
                      {blocks.map((b) => (
                        <MenuItem key={b} value={b}>
                          Block {b}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              </Paper>
            </Grid>
          </Grid>

          {/* Tabs + search + export */}
          <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ xs: 'stretch', md: 'center' }}
              justifyContent="space-between"
              spacing={1.5}
              sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}
            >
              <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                textColor="primary"
                indicatorColor="primary"
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label="All issues" value="all" />
                {Object.entries(STATUS_GROUPS).map(([key, group]) => (
                  <Tab key={key} label={group.label} value={key} />
                ))}
              </Tabs>

              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  placeholder="Search by block, category or status..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ minWidth: 260 }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <Tooltip title="Reset filters">
                  <span>
                    <IconButton size="small" onClick={resetFilters} disabled={!isFiltering}>
                      <FilterAltOffOutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>

            {/* Table */}
            {pageRows.length === 0 ? (
              <EmptyState
                dense
                icon={GridViewOutlinedIcon}
                description="No reports match your search or filters."
                actionLabel={isFiltering ? 'Reset filters' : undefined}
                onAction={isFiltering ? resetFilters : undefined}
              />
            ) : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Issue</TableCell>
                      <TableCell>Block / Location</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Reported</TableCell>
                      <TableCell>Updated</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pageRows.map((r) => {
                      const display = statusDisplay(r.status);
                      const cat = categoryDisplay(r.category);
                      const CatIcon = cat.icon;
                      return (
                        <TableRow key={r.id} hover>
                          <TableCell>
                            <Stack direction="row" spacing={1.5} alignItems="center">
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 34,
                                  height: 34,
                                  borderRadius: 1.5,
                                  flexShrink: 0,
                                  color: `${cat.color}.main`,
                                  bgcolor: (t) => alpha(t.palette[cat.color].main, 0.12),
                                }}
                              >
                                <CatIcon fontSize="small" />
                              </Box>
                              <Typography variant="body2" fontWeight={600}>
                                {r.category} issue
                              </Typography>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">Block {r.location_block}</Typography>
                          </TableCell>
                          <TableCell>
                            <Chip size="small" variant="outlined" label={r.category} />
                          </TableCell>
                          <TableCell>
                            <Chip size="small" color={display.color} label={display.label} />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {timeAgo(r.created_at)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {timeAgo(r.updated_at)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {/* Pagination */}
            {filtered.length > 0 && (
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                alignItems="center"
                justifyContent="space-between"
                spacing={1.5}
                sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}
              >
                <Typography variant="caption" color="text.secondary">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of{' '}
                  {filtered.length} results
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <IconButton size="small" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeftIcon fontSize="small" />
                  </IconButton>
                  <Typography variant="caption">
                    Page {page} of {totalPages}
                  </Typography>
                  <IconButton
                    size="small"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRightIcon fontSize="small" />
                  </IconButton>
                  <FormControl size="small">
                    <Select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                      {PAGE_SIZES.map((n) => (
                        <MenuItem key={n} value={n}>
                          {n} / page
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              </Stack>
            )}
          </Paper>
        </>
      )}
    </Box>
  );
}
