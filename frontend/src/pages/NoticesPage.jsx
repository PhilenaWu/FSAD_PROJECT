// Sidebar "Notices" — dedicated page for the same honest placeholder shown on
// the resident home page. UC-008's resident-facing notice feed has no read
// endpoint yet, so this stays a placeholder rather than inventing content.
import { Box, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';

export default function NoticesPage() {
  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 720, mx: 'auto' }}>
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
          <CampaignOutlinedIcon />
        </Box>
        <Typography variant="h5" fontWeight={700}>
          Notices
        </Typography>
      </Stack>

      <Paper
        variant="outlined"
        sx={{ p: 4, borderRadius: 2, textAlign: 'center', borderStyle: 'dashed' }}
      >
        <Typography variant="body1" color="text.secondary">
          Estate notices from your town council will appear here soon.
        </Typography>
      </Paper>
    </Box>
  );
}
