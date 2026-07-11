// Landing stub for roles whose workspace isn't built yet (contractor, admin).
// Keeps the role-based login redirect from dead-ending while those pages land.
import { Box, Paper, Typography } from '@mui/material';
import ConstructionOutlinedIcon from '@mui/icons-material/ConstructionOutlined';

export default function WorkspacePlaceholder() {
  return (
    <Box
      sx={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 2,
      }}
    >
      <Paper elevation={2} sx={{ p: 4, borderRadius: 3, textAlign: 'center' }}>
        <ConstructionOutlinedIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
        <Typography variant="h6" fontWeight={700}>
          Your workspace isn't ready yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This part of EM Services is still being built. Check back soon.
        </Typography>
      </Paper>
    </Box>
  );
}
