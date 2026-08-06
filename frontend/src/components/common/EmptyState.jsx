// Shared "nothing here yet" block — icon + message + optional CTA — for
// sections that currently render as bare secondary text. Purely visual: it
// renders whatever empty/zero-result copy the page already had, just with
// more presence than a lone line of grey text.
import { Box, Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { alpha } from '@mui/material/styles';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  dense = false,
  sx,
}) {
  return (
    <Stack alignItems="center" spacing={0.75} sx={{ py: dense ? 3 : 5, textAlign: 'center', ...sx }}>
      {Icon && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: dense ? 40 : 48,
            height: dense ? 40 : 48,
            borderRadius: '50%',
            color: 'primary.main',
            bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
            mb: 0.5,
          }}
        >
          <Icon fontSize={dense ? 'small' : 'medium'} />
        </Box>
      )}
      {title && (
        <Typography variant={dense ? 'body2' : 'subtitle1'} fontWeight={700} color="text.primary">
          {title}
        </Typography>
      )}
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          {description}
        </Typography>
      )}
      {actionLabel && actionTo && (
        <Button size="small" variant="outlined" component={RouterLink} to={actionTo} sx={{ mt: 1 }}>
          {actionLabel}
        </Button>
      )}
      {actionLabel && !actionTo && onAction && (
        <Button size="small" variant="outlined" onClick={onAction} sx={{ mt: 1 }}>
          {actionLabel}
        </Button>
      )}
    </Stack>
  );
}
