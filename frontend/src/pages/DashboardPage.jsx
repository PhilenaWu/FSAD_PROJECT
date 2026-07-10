// Placeholder dashboard page — routing stub, styled to match the intended
// layout (dashed-border content area). No real data/analytics yet.
import { Box, Stack, Typography } from '@mui/material';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';

export default function DashboardPage() {
  return (
    <Box sx={{ p: { xs: 2, sm: 4 } }}>
      <Box
        sx={{
          border: '2px dashed',
          borderColor: 'divider',
          borderRadius: 2,
          minHeight: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Stack spacing={1} alignItems="center">
          <GridViewOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
          <Typography color="text.secondary">page content area</Typography>
        </Stack>
      </Box>
    </Box>
  );
}
