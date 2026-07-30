// Centered spinner shown while a lazy-loaded page chunk downloads. Kept tiny
// and dependency-free so the fallback itself never delays the paint.
import { CircularProgress, Stack } from '@mui/material';

export default function PageLoader() {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ py: 10 }}>
      <CircularProgress />
    </Stack>
  );
}
