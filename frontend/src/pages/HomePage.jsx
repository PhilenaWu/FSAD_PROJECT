// Resident home page — greeting, quick actions, a traffic-light summary of the
// resident's own reports, the latest estate-wide activity, and a notices
// placeholder (UC-008 is Zoe's; no resident read endpoint exists yet).
// Reuses GET /api/inspections/my and /status-board — no new backend.
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Box,
  Chip,
  Container,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { STATUS_GROUPS, statusDisplay, statusGroup } from '../utils/statusDisplay';
import { timeAgo } from '../utils/timeAgo';

const QUICK_ACTIONS = [
  {
    label: 'Report an issue',
    caption: 'Spotted a defect? Tell us about it',
    to: '/report',
    icon: AddCircleOutlineIcon,
  },
  {
    label: 'My reports',
    caption: 'Track the reports you have filed',
    to: '/my-reports',
    icon: AssignmentOutlinedIcon,
  },
];

export default function HomePage() {
  const { profile } = useAuth();
  const [myReports, setMyReports] = useState([]);
  const [estate, setEstate] = useState([]);

  // Both fetches are best-effort — the page renders fine with either missing.
  useEffect(() => {
    let active = true;
    api
      .get('/api/inspections/my')
      .then((res) => active && setMyReports(res.data.data))
      .catch(() => {});
    api
      .get('/api/inspections/status-board')
      .then((res) => active && setEstate(res.data.data.slice(0, 3)))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const counts = { review: 0, progress: 0, done: 0 };
  for (const r of myReports) counts[statusGroup(r.status)] += 1;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 720 }}>
        <Stack spacing={3}>
          {/* 1. Greeting */}
          <Box>
            <Typography variant="h4" component="h1" fontWeight={700} sx={{ color: 'primary.main' }}>
              Hi {profile?.full_name ?? 'there'}
            </Typography>
            {profile?.block_number && (
              <Typography variant="body2" color="text.secondary">
                Block {profile.block_number}
                {profile.unit_number ? ` · #${profile.unit_number}` : ''}
              </Typography>
            )}
          </Box>

          {/* 2. Quick actions */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {QUICK_ACTIONS.map(({ label, caption, to, icon: Icon }) => (
              <Paper
                key={to}
                component={RouterLink}
                to={to}
                elevation={2}
                sx={{
                  flex: 1,
                  p: 3,
                  borderRadius: 3,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  transition: (theme) => theme.transitions.create('box-shadow'),
                  '&:hover': { boxShadow: 6 },
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 44,
                    height: 44,
                    borderRadius: 2,
                    color: 'primary.main',
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                  }}
                >
                  <Icon />
                </Box>
                <Box>
                  <Typography variant="subtitle1" fontWeight={700} color="text.primary">
                    {label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {caption}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Stack>

          {/* 3. My reports summary */}
          <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                My reports
              </Typography>
              <Link component={RouterLink} to="/my-reports" underline="hover" variant="body2">
                View all
              </Link>
            </Stack>
            {myReports.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                You haven't filed any reports yet.
              </Typography>
            ) : (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {Object.entries(STATUS_GROUPS).map(([key, group]) => (
                  <Chip
                    key={key}
                    size="small"
                    variant="outlined"
                    color={group.color}
                    label={`${group.label} · ${counts[key]}`}
                  />
                ))}
              </Stack>
            )}
          </Paper>

          {/* 4. Around the estate */}
          <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                Around the estate
              </Typography>
              <Link component={RouterLink} to="/status-board" underline="hover" variant="body2">
                View all
              </Link>
            </Stack>
            {estate.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing reported around the estate yet.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {estate.map((r) => {
                  const group = STATUS_GROUPS[statusGroup(r.status)];
                  return (
                    <Stack
                      key={r.id}
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Typography variant="body2" noWrap>
                        Block {r.location_block} · {r.category} ·{' '}
                        <Typography component="span" variant="body2" color="text.secondary">
                          {timeAgo(r.created_at)}
                        </Typography>
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={group.color}
                        label={statusDisplay(r.status).label}
                      />
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </Paper>

          {/* 5. Notices — placeholder only; UC-008 resident feed is Zoe's. */}
          <Paper
            elevation={0}
            sx={{ p: 3, borderRadius: 3, border: '1px dashed', borderColor: 'divider' }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CampaignOutlinedIcon sx={{ color: 'text.secondary' }} />
              <Box>
                <Typography variant="subtitle2" fontWeight={700} color="text.secondary">
                  Notices
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Estate notices from your town council will appear here soon.
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
