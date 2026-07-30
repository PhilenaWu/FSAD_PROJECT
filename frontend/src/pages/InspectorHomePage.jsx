// Inspector landing page (/dashboard for role=inspector). Greeting + quick
// actions (new inspection, past inspections) and a count of completed work
// awaiting the inspector's review, linking into the read-only queue.
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Box, Container, Link, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const QUICK_ACTIONS = [
  {
    label: 'New inspection',
    caption: 'Start a lift spot-check',
    to: '/inspections/new',
    icon: AddCircleOutlineIcon,
  },
  {
    label: 'Past inspections',
    caption: 'Inspections you have filed',
    to: '/my-reports',
    icon: AssignmentOutlinedIcon,
  },
];

export default function InspectorHomePage() {
  const { profile } = useAuth();
  const [pendingCount, setPendingCount] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .get('/api/inspections', { params: { status: 'Rectified' } })
      .then((res) => active && setPendingCount(res.data.total ?? res.data.data.length))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="sm" disableGutters sx={{ maxWidth: 720 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4" component="h1" fontWeight={700} sx={{ color: 'primary.main' }}>
              Hi {profile?.full_name ?? 'there'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Inspector
            </Typography>
          </Box>

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

          <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 44,
                    height: 44,
                    borderRadius: 2,
                    color: 'success.main',
                    bgcolor: (theme) => alpha(theme.palette.success.main, 0.1),
                  }}
                >
                  <FactCheckOutlinedIcon />
                </Box>
                <Box>
                  <Typography variant="subtitle1" fontWeight={700}>
                    Completed work awaiting review
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {pendingCount === null
                      ? 'Loading…'
                      : `${pendingCount} inspection${pendingCount === 1 ? '' : 's'} ready for you to check`}
                  </Typography>
                </Box>
              </Stack>
              <Link component={RouterLink} to="/inspections" underline="hover" variant="body2">
                View all
              </Link>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
