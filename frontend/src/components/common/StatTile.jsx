// Small stat tile: circular colored icon badge + label + value, optional
// caption below. Shared by HomePage and MyReportsPage.
import { Box, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

export default function StatTile({ label, value, sub, icon: Icon, iconColor }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
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
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography variant="h5" fontWeight={700} sx={{ color: `${iconColor}.main` }}>
            {value}
          </Typography>
        </Box>
      </Stack>
      {sub && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}
