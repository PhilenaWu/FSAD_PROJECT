// Inspector landing page (/dashboard for role=inspector). Greeting + quick
// actions + a real KPI overview of the inspector's own inspections.
// Note: the reference mockup for this page also showed an "Upcoming
// inspections" calendar (specific dates/times/durations, a "View calendar"
// link). That's a scheduling feature this app doesn't have anywhere —
// inspections have no scheduled_at/appointment concept, just a status and an
// optional contractor deadline — so it's left out rather than filled with
// invented appointments. Flag if you want that built as a real feature.
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Box, Chip, Divider, Grid2 as Grid, Link, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { statusDisplay, statusGroup } from '../utils/statusDisplay';
import StatTile from '../components/common/StatTile';
import EmptyState from '../components/common/EmptyState';

const RECENT_COUNT = 5;

// Small "MMM / DD" date badge — mirrors the day badge style from the
// reference mockup's (invented) schedule, but stamped with when the record
// was actually filed, which is real.
function DateBadge({ iso }) {
  const d = new Date(iso);
  return (
    <Box
      sx={{
        width: 48,
        flexShrink: 0,
        textAlign: 'center',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        py: 0.5,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
        {d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
      </Typography>
      <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.2 }}>
        {d.getDate()}
      </Typography>
    </Box>
  );
}

function quickActions(pendingCount) {
  return [
    {
      label: 'New inspection',
      caption: 'Start a lift spot-check',
      to: '/inspections/new',
      icon: AddCircleOutlineIcon,
      color: 'primary',
    },
    {
      label: 'Past inspections',
      caption: 'View and manage your submitted inspections',
      to: '/my-reports',
      icon: AssignmentOutlinedIcon,
      color: 'info',
    },
    {
      label: 'Completed work',
      // Real count carried over from the pre-redesign page (GET
      // /api/inspections?status=Rectified) — work rectified by a contractor
      // and awaiting the inspector's joint endorsement.
      caption:
        pendingCount === null
          ? 'Review work completed and ready for your check'
          : `${pendingCount} inspection${pendingCount === 1 ? '' : 's'} ready for your check`,
      to: '/inspections',
      icon: FactCheckOutlinedIcon,
      color: 'success',
    },
  ];
}

// Small decorative header illustration — purely visual, no data.
function CityIllustration() {
  return (
    <Box component="svg" viewBox="0 0 220 130" sx={{ width: 200, height: 118, display: { xs: 'none', sm: 'block' } }}>
      <circle cx="40" cy="35" r="20" fill="#DBEAFE" />
      <circle cx="185" cy="25" r="14" fill="#E0E7FF" />
      <rect x="120" y="30" width="60" height="90" rx="4" fill="#E5E7EB" />
      <rect x="130" y="10" width="46" height="110" rx="4" fill="#94A3B8" />
      {[0, 1, 2, 3, 4].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={137 + col * 12}
            y={22 + row * 18}
            width="8"
            height="10"
            rx="1"
            fill="#DBEAFE"
          />
        ))
      )}
      <path d="M130 10 L153 -6 L176 10" fill="#64748B" />
      <rect x="60" y="70" width="14" height="50" rx="2" fill="#16A34A" />
      <circle cx="67" cy="66" r="10" fill="#22C55E" />
      <rect x="188" y="80" width="12" height="40" rx="2" fill="#16A34A" />
      <circle cx="194" cy="76" r="9" fill="#22C55E" />
    </Box>
  );
}

export default function InspectorHomePage() {
  const { profile } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [pendingCount, setPendingCount] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .get('/api/inspections/my')
      .then((res) => active && setInspections(res.data.data))
      .catch(() => {})
      .finally(() => active && setLoaded(true));
    api
      .get('/api/inspections', { params: { status: 'Rectified' } })
      .then((res) => active && setPendingCount(res.data.total ?? res.data.data.length))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c = { review: 0, progress: 0, done: 0 };
    for (const r of inspections) c[statusGroup(r.status)] += 1;
    return c;
  }, [inspections]);

  // "Resolved" carries a "this month" caption, so it's scoped to that window
  // rather than all-time — matched against when the record actually closed.
  const resolvedThisMonth = useMemo(() => {
    const now = new Date();
    return inspections.filter((r) => {
      if (statusGroup(r.status) !== 'done') return false;
      const when = new Date(r.closed_at ?? r.updated_at);
      return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth();
    }).length;
  }, [inspections]);

  // API already returns the caller's inspections newest-first.
  const recent = inspections.slice(0, RECENT_COUNT);

  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700} sx={{ color: 'primary.main' }}>
            Hi {profile?.full_name ?? 'there'}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Here's what's happening with your inspections today.
          </Typography>
        </Box>
        <CityIllustration />
      </Stack>

      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        Quick actions
      </Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {quickActions(pendingCount).map(({ label, caption, to, icon: Icon, color }) => (
          <Grid key={to} size={{ xs: 12, sm: 4 }}>
            <Paper
              component={RouterLink}
              to={to}
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: 2,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                textDecoration: 'none',
                color: 'inherit',
                transition: (t) => t.transitions.create('box-shadow'),
                '&:hover': { boxShadow: 3 },
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  flexShrink: 0,
                  color: `${color}.main`,
                  bgcolor: (t) => alpha(t.palette[color].main, 0.12),
                }}
              >
                <Icon />
              </Box>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  {label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {caption}
                </Typography>
              </Box>
              <ChevronRightIcon sx={{ color: 'text.secondary', flexShrink: 0 }} />
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        Overview
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Under review"
            value={loaded ? counts.review : '—'}
            sub="Requires your action"
            icon={AccessTimeOutlinedIcon}
            iconColor="error"
            to="/my-reports"
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="In progress"
            value={loaded ? counts.progress : '—'}
            sub="Ongoing inspections"
            icon={HourglassEmptyOutlinedIcon}
            iconColor="warning"
            to="/my-reports"
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Resolved"
            value={loaded ? resolvedThisMonth : '—'}
            sub="Completed this month"
            icon={CheckCircleOutlineIcon}
            iconColor="success"
            to="/my-reports"
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Total inspections"
            value={loaded ? inspections.length : '—'}
            sub="All time"
            icon={DescriptionOutlinedIcon}
            iconColor="secondary"
            to="/my-reports"
          />
        </Grid>
      </Grid>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 4, mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Recent inspections
        </Typography>
        <Link component={RouterLink} to="/my-reports" underline="hover" variant="body2">
          View all
        </Link>
      </Stack>
      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        {!loaded ? (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Loading…
            </Typography>
          </Box>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={DescriptionOutlinedIcon}
            title="No inspections yet"
            description="Inspections you file will show up here."
            actionLabel="New inspection"
            actionTo="/inspections/new"
          />
        ) : (
          <Stack divider={<Divider />}>
            {recent.map((r) => {
              const display = statusDisplay(r.status);
              return (
                <Stack
                  key={r.id}
                  component={RouterLink}
                  to="/my-reports"
                  direction="row"
                  alignItems="center"
                  spacing={2}
                  sx={{
                    p: 2,
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: (t) => t.transitions.create('background-color'),
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <DateBadge iso={r.created_at} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>
                      {r.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Block {r.location_block} · {r.category}
                    </Typography>
                  </Box>
                  <Chip size="small" color={display.color} label={display.label} />
                  <ChevronRightIcon sx={{ color: 'text.secondary', flexShrink: 0 }} />
                </Stack>
              );
            })}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
