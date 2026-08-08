// Small stat tile: circular colored icon badge + label + value, optional
// caption below. Shared by HomePage, MyReportsPage and InspectorHomePage.
// `to`: optional — makes the whole tile a link (with a trailing chevron) to
// wherever that number's detail actually lives, instead of a static card.
// `onClick`: optional alternative to `to` for pages with no separate route per
// stat (e.g. ContractorInboxPage's stats filter the current page's tab
// instead of navigating) — same interactive styling (hover shadow + chevron),
// a click handler instead of a link. `to` wins if both are given.
import { Box, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { alpha } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

export default function StatTile({ label, value, sub, icon: Icon, iconColor, to, onClick }) {
  const interactive = Boolean(to || onClick);
  return (
    <Paper
      variant="outlined"
      component={to ? RouterLink : 'div'}
      to={to}
      onClick={!to ? onClick : undefined}
      sx={{
        p: 2,
        borderRadius: 2,
        height: '100%',
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        ...(interactive && {
          cursor: 'pointer',
          transition: (t) => t.transitions.create('box-shadow'),
          '&:hover': { boxShadow: 2 },
        }),
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: '50%',
            flexShrink: 0,
            color: `${iconColor}.main`,
            bgcolor: (t) => alpha(t.palette[iconColor].main, 0.12),
          }}
        >
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography variant="h5" fontWeight={700} sx={{ color: `${iconColor}.main` }}>
            {value}
          </Typography>
        </Box>
        {interactive && <ChevronRightIcon sx={{ color: 'text.secondary', flexShrink: 0 }} />}
      </Stack>
      {sub && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}
