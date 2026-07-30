// UC-011 chart/section wrapper — outlined Paper with a title and a period
// subtitle so each panel states the window its numbers cover.
import { Box, Paper, Stack, Typography } from '@mui/material';

export default function CostPanel({ title, subtitle, action, children }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box>
          {/* component="div": titles may contain a Chip (a div), invalid inside h6. */}
          <Typography variant="subtitle1" component="div" fontWeight={700}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2, minHeight: 18 }}>
            {subtitle}
          </Typography>
        </Box>
        {action && <Box sx={{ displayPrint: 'none' }}>{action}</Box>}
      </Stack>
      {children}
    </Paper>
  );
}
